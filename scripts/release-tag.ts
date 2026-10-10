#!/usr/bin/env bun

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface Version {
	major: bigint;
	minor: bigint;
	patch: bigint;
	rc: bigint | null;
}

const VERSION_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.(0|[1-9]\d*))?$/;

function run(args: readonly string[]): CommandResult {
	const result = Bun.spawnSync({
		cmd: [...args],
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stdout: new TextDecoder().decode(result.stdout),
		stderr: new TextDecoder().decode(result.stderr),
	};
}

function checked(args: readonly string[]): CommandResult {
	const result = run(args);
	if (result.exitCode !== 0) {
		const detail = [result.stderr.trim(), result.stdout.trim()]
			.filter(Boolean)
			.join("; ");
		throw new Error(
			`${args[0]} ${args.slice(1).join(" ")} failed${detail ? `: ${detail}` : ""}`,
		);
	}
	return result;
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function parseVersion(value: string): Version | null {
	if (!VERSION_PATTERN.test(value)) return null;
	const [major, minor, patch, rc] = value.split(/\.|-rc\./);
	if (major === undefined || minor === undefined || patch === undefined)
		return null;
	return {
		major: BigInt(major),
		minor: BigInt(minor),
		patch: BigInt(patch),
		rc: rc === undefined ? null : BigInt(rc),
	};
}

function compareVersions(left: Version, right: Version): number {
	const components: ReadonlyArray<readonly [bigint, bigint]> = [
		[left.major, right.major],
		[left.minor, right.minor],
		[left.patch, right.patch],
	];
	for (const [leftPart, rightPart] of components) {
		if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
	}
	if (left.rc === null) return right.rc === null ? 0 : 1;
	if (right.rc === null) return -1;
	return left.rc === right.rc ? 0 : left.rc < right.rc ? -1 : 1;
}

function requireValidVersion(value: string): Version {
	const version = parseVersion(value);
	if (!version) {
		throw new Error(
			`Invalid owned version '${value}'; expected X.Y.Z or X.Y.Z-rc.N with canonical non-negative integers`,
		);
	}
	return version;
}

function readVersionAt(commit: string): string | null {
	const exists = run(["git", "cat-file", "-e", `${commit}:package.json`]);
	if (exists.exitCode !== 0) {
		const validCommit = run([
			"git",
			"rev-parse",
			"--verify",
			"--quiet",
			`${commit}^{commit}`,
		]);
		if (validCommit.exitCode !== 0) {
			throw new Error(`Invalid commit '${commit}'`);
		}
		return null;
	}

	const contents = checked(["git", "show", `${commit}:package.json`]).stdout;
	const parsed: unknown = JSON.parse(contents);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`package.json at ${commit} must be a JSON object`);
	}
	if (!("version" in parsed) || typeof parsed.version !== "string") {
		throw new Error(
			`package.json at ${commit} must have a string version field`,
		);
	}
	return parsed.version;
}

function latestTag(): { tag: string; version: Version } | null {
	const tags = checked(["git", "tag", "--list", "v*"]).stdout.split("\n");
	let latest: { tag: string; version: Version } | null = null;
	for (const tag of tags) {
		if (!tag.startsWith("v")) continue;
		const version = parseVersion(tag.slice(1));
		if (!version) continue;
		if (latest === null || compareVersions(version, latest.version) > 0) {
			latest = { tag, version };
		}
	}
	return latest;
}

function requireGreaterThanLatest(value: string, version: Version): void {
	const latest = latestTag();
	if (latest && compareVersions(version, latest.version) <= 0) {
		throw new Error(
			`Invalid version '${value}'; expected a version greater than ${latest.tag}`,
		);
	}
}

function checkVersion(): void {
	const baseSha = requiredEnv("BASE_SHA");
	const headSha = requiredEnv("HEAD_SHA");
	const baseVersion = readVersionAt(baseSha);
	const headVersion = readVersionAt(headSha);
	if (baseVersion === null || headVersion === null) {
		throw new Error("package.json must exist at both BASE_SHA and HEAD_SHA");
	}
	if (baseVersion === headVersion) {
		console.log("package.json version unchanged; check skipped.");
		return;
	}

	const version = requireValidVersion(headVersion);
	requireGreaterThanLatest(headVersion, version);
	console.log(`Version ${headVersion} is valid.`);
}

function mintTag(): void {
	const releaseSha = requiredEnv("RELEASE_SHA");
	const repository = requiredEnv("RELEASE_REPOSITORY");
	const releaseVersion = readVersionAt(releaseSha);
	if (releaseVersion === null) {
		throw new Error(`Could not read package.json at ${releaseSha}`);
	}
	const tag = `v${releaseVersion}`;
	if (
		run(["git", "show-ref", "--verify", "--quiet", `refs/tags/${tag}`])
			.exitCode === 0
	) {
		console.log(`Tag ${tag} already exists; nothing to mint.`);
		return;
	}

	const version = requireValidVersion(releaseVersion);
	requireGreaterThanLatest(releaseVersion, version);

	let target: string | null = null;
	const commits = checked(["git", "rev-list", "--first-parent", releaseSha])
		.stdout.trim()
		.split("\n");
	for (const commit of commits) {
		if (!commit) continue;
		const versionAtCommit = readVersionAt(commit);
		if (versionAtCommit === null || versionAtCommit !== releaseVersion) break;
		target = commit;
	}
	if (target === null) {
		throw new Error(
			`Could not find the first-parent commit that set ${releaseVersion}`,
		);
	}

	const response = run([
		"gh",
		"api",
		`repos/${repository}/git/refs`,
		"--method",
		"POST",
		"-f",
		`ref=refs/tags/${tag}`,
		"-f",
		`sha=${target}`,
	]);
	if (response.exitCode === 0) {
		console.log(`Created ${tag} at ${target}.`);
		return;
	}

	const detail = [response.stderr.trim(), response.stdout.trim()]
		.filter(Boolean)
		.join("; ");
	if (/\b422\b/.test(detail) && /Reference already exists/i.test(detail)) {
		const existing = run([
			"gh",
			"api",
			`repos/${repository}/git/ref/tags/${tag}`,
			"--jq",
			".object.sha",
		]);
		if (existing.exitCode !== 0) {
			throw new Error(
				`Could not verify existing ${tag}: ${existing.stderr.trim() || existing.stdout.trim()}`,
			);
		}
		const actual = existing.stdout.trim();
		if (actual === target) {
			console.log(`Tag ${tag} was created concurrently at ${target}.`);
			return;
		}
		throw new Error(
			`Tag ${tag} already exists at ${actual}, expected ${target}`,
		);
	}
	throw new Error(
		`Could not create ${tag}: ${detail || `gh exited ${response.exitCode}`}`,
	);
}

function resolveTag(args: readonly string[]): void {
	if (args.length !== 3)
		throw new Error("Usage: release-tag.ts resolve <tag> <sha>");
	const tag = args[1];
	const sha = args[2];
	if (
		tag === undefined ||
		sha === undefined ||
		!tag.startsWith("v") ||
		!parseVersion(tag.slice(1))
	) {
		throw new Error(
			`Invalid release tag '${tag ?? ""}'; expected vX.Y.Z or vX.Y.Z-rc.N`,
		);
	}

	const ancestry = run([
		"git",
		"merge-base",
		"--is-ancestor",
		sha,
		"origin/main",
	]);
	if (ancestry.exitCode === 1)
		throw new Error(`${sha} is not reachable from origin/main`);
	if (ancestry.exitCode !== 0) {
		throw new Error(
			`Could not verify that ${sha} is reachable from origin/main: ${ancestry.stderr.trim()}`,
		);
	}
	const versionAtCommit = readVersionAt(sha);
	if (versionAtCommit === null)
		throw new Error(`Could not read package.json at ${sha}`);
	requireValidVersion(versionAtCommit);
	if (tag !== `v${versionAtCommit}`) {
		throw new Error(
			`Tag ${tag} does not match package.json at ${sha} (v${versionAtCommit})`,
		);
	}
	console.log(`Resolved ${tag} at ${sha}.`);
}

function main(args: readonly string[]): void {
	const command = args[0];
	if (command === "check" && args.length === 1) {
		checkVersion();
		return;
	}
	if (command === "mint" && args.length === 1) {
		mintTag();
		return;
	}
	if (command === "resolve") {
		resolveTag(args);
		return;
	}
	throw new Error("Usage: release-tag.ts {check|mint|resolve <tag> <sha>}");
}

try {
	main(process.argv.slice(2));
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`::error::${message.replace(/[\r\n]+/g, " ")}`);
	process.exitCode = 1;
}
