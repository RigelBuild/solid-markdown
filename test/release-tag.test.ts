import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../scripts/release-tag.ts");
const directories: string[] = [];

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function scratchDirectory(): Promise<string> {
	const directory = await mkdtemp(
		join(tmpdir(), "solid-markdown-release-tag-"),
	);
	directories.push(directory);
	return directory;
}

function command(
	args: readonly string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): CommandResult {
	const result = Bun.spawnSync({
		cmd: [...args],
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stdout: new TextDecoder().decode(result.stdout),
		stderr: new TextDecoder().decode(result.stderr),
	};
}

function git(repository: string, ...args: string[]): string {
	const result = command(["git", ...args], { cwd: repository });
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

async function createRepository(
	directory: string,
	version: string,
	name = "base",
): Promise<string> {
	const repository = join(directory, "repo");
	await mkdir(repository, { recursive: true });
	git(repository, "init", "-q", "-b", "main");
	git(repository, "config", "user.name", "Release Tag Test");
	git(repository, "config", "user.email", "release-tag@example.invalid");
	await writePackage(repository, version, name);
	git(repository, "add", "package.json");
	git(repository, "commit", "-q", "-m", `set ${version}`);
	return repository;
}

async function writePackage(
	repository: string,
	version: string,
	name = "base",
): Promise<void> {
	await writeFile(
		join(repository, "package.json"),
		`${JSON.stringify({ name, version }, null, 2)}\n`,
	);
}

async function commitPackage(
	repository: string,
	version: string,
	name = version,
): Promise<string> {
	await writePackage(repository, version, name);
	git(repository, "add", "package.json");
	git(repository, "commit", "-q", "-m", `set ${version}`);
	return git(repository, "rev-parse", "HEAD");
}

async function commitFile(
	repository: string,
	file: string,
	contents: string,
): Promise<string> {
	await writeFile(join(repository, file), contents);
	git(repository, "add", file);
	git(repository, "commit", "-q", "-m", `update ${file}`);
	return git(repository, "rev-parse", "HEAD");
}

async function createGhStub(
	directory: string,
): Promise<{ path: string; calls: string }> {
	const bin = join(directory, "bin");
	await mkdir(bin, { recursive: true });
	const path = join(bin, "gh");
	const calls = join(directory, "gh-calls.log");
	await writeFile(
		path,
		`#!/bin/sh
printf '%s\\n' "$*" >> "$GH_CALL_LOG"
case "$*" in
  *"git/refs --method POST"*)
    if [ "$GH_MODE" = same ] || [ "$GH_MODE" = different ]; then
      echo 'HTTP 422: Reference already exists' >&2
      exit 1
    fi
    echo created
    ;;
  *"git/ref/tags/"*)
    printf '%s\\n' "$GH_EXISTING_SHA"
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 2
    ;;
esac
`,
	);
	await chmod(path, 0o755);
	return { path: bin, calls };
}

function envForGh(
	stub: { path: string; calls: string },
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		PATH: `${stub.path}:${process.env.PATH ?? ""}`,
		GH_CALL_LOG: stub.calls,
		GH_MODE: "create",
		GH_EXISTING_SHA: "",
		...extra,
	};
}

function runScript(
	repository: string,
	args: readonly string[],
	env: Record<string, string> = {},
): CommandResult {
	return command(["bun", script, ...args], { cwd: repository, env });
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("release tag minting", () => {
	it("targets the oldest first-parent commit that set the version", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "0.8.0");
		const base = git(repository, "rev-parse", "HEAD");
		const target = await commitPackage(repository, "0.9.0");
		const tip = await commitFile(repository, "later.txt", "later change\n");
		git(repository, "tag", "v0.8.0", base);
		const stub = await createGhStub(directory);

		const result = runScript(
			repository,
			["mint"],
			envForGh(stub, {
				RELEASE_SHA: tip,
				RELEASE_REPOSITORY: "RigelBuild/solid-markdown",
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(await Bun.file(stub.calls).text()).toContain(`sha=${target}`);
		expect(await Bun.file(stub.calls).text()).not.toContain(`sha=${tip}`);
	});

	it("does not call GitHub when the local tag already exists", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "0.9.0");
		const tip = git(repository, "rev-parse", "HEAD");
		git(repository, "tag", "v0.9.0", tip);
		const stub = await createGhStub(directory);

		const result = runScript(
			repository,
			["mint"],
			envForGh(stub, {
				RELEASE_SHA: tip,
				RELEASE_REPOSITORY: "RigelBuild/solid-markdown",
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("already exists; nothing to mint");
		expect(await Bun.file(stub.calls).exists()).toBe(false);
	});

	it("accepts a concurrent 422 tag creation at the expected target", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "0.8.0");
		const base = git(repository, "rev-parse", "HEAD");
		const target = await commitPackage(repository, "0.9.0");
		git(repository, "tag", "v0.8.0", base);
		const stub = await createGhStub(directory);

		const result = runScript(
			repository,
			["mint"],
			envForGh(stub, {
				GH_MODE: "same",
				GH_EXISTING_SHA: target,
				RELEASE_SHA: target,
				RELEASE_REPOSITORY: "RigelBuild/solid-markdown",
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("created concurrently");
		expect(
			(await Bun.file(stub.calls).text()).split("\n").filter(Boolean),
		).toHaveLength(2);
	});

	it("rejects a concurrent 422 tag creation at a different target", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "0.8.0");
		const base = git(repository, "rev-parse", "HEAD");
		const target = await commitPackage(repository, "0.9.0");
		git(repository, "tag", "v0.8.0", base);
		const stub = await createGhStub(directory);

		const result = runScript(
			repository,
			["mint"],
			envForGh(stub, {
				GH_MODE: "different",
				GH_EXISTING_SHA: base,
				RELEASE_SHA: target,
				RELEASE_REPOSITORY: "RigelBuild/solid-markdown",
			}),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(`expected ${target}`);
	});
});

describe("release version check", () => {
	it("skips when only other package metadata changed", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "1.0.0", "before");
		const base = git(repository, "rev-parse", "HEAD");
		const head = await commitPackage(repository, "1.0.0", "after");

		const result = runScript(repository, ["check"], {
			BASE_SHA: base,
			HEAD_SHA: head,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("version unchanged; check skipped");
	});

	it("accepts a changed version greater than the latest tag", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "1.0.0");
		const base = git(repository, "rev-parse", "HEAD");
		git(repository, "tag", "v1.0.0", base);
		const head = await commitPackage(repository, "1.1.0");

		const result = runScript(repository, ["check"], {
			BASE_SHA: base,
			HEAD_SHA: head,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Version 1.1.0 is valid");
	});

	it("rejects an equal or lower version than the latest tag", async () => {
		for (const version of ["1.0.0", "0.9.9"]) {
			const directory = await scratchDirectory();
			const repository = await createRepository(directory, "0.8.0");
			const base = git(repository, "rev-parse", "HEAD");
			git(repository, "tag", "v1.0.0", base);
			const head = await commitPackage(repository, version);

			const result = runScript(repository, ["check"], {
				BASE_SHA: base,
				HEAD_SHA: head,
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("expected a version greater than v1.0.0");
		}
	});

	it("orders release candidates before their final release and compares rc numbers", async () => {
		const cases = [
			{ candidate: "3.0.0-rc.1", latest: "3.0.0-rc.0", succeeds: true },
			{ candidate: "3.0.0", latest: "3.0.0-rc.9", succeeds: true },
			{ candidate: "3.0.0-rc.0", latest: "2.9.9", succeeds: true },
		];
		for (const { candidate, latest, succeeds } of cases) {
			const directory = await scratchDirectory();
			const repository = await createRepository(directory, "2.0.0");
			const base = git(repository, "rev-parse", "HEAD");
			git(repository, "tag", `v${latest}`, base);
			const head = await commitPackage(repository, candidate);

			const result = runScript(repository, ["check"], {
				BASE_SHA: base,
				HEAD_SHA: head,
			});

			expect(result.exitCode === 0).toBe(succeeds);
		}
	});

	it("rejects beta labels and leading-zero components", async () => {
		for (const version of ["3.0.0-beta.1", "03.0.0"]) {
			const directory = await scratchDirectory();
			const repository = await createRepository(directory, "2.0.0");
			const base = git(repository, "rev-parse", "HEAD");
			const head = await commitPackage(repository, version);

			const result = runScript(repository, ["check"], {
				BASE_SHA: base,
				HEAD_SHA: head,
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Invalid owned version");
		}
	});
});

describe("release tag resolution", () => {
	it("resolves a matching tag whose commit is on origin/main", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "1.2.3-rc.4");
		const sha = git(repository, "rev-parse", "HEAD");
		git(repository, "update-ref", "refs/remotes/origin/main", sha);

		const result = runScript(repository, ["resolve", "v1.2.3-rc.4", sha]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(`Resolved v1.2.3-rc.4 at ${sha}`);
	});

	it("rejects a tag that does not match the commit package version", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "1.2.3");
		const sha = git(repository, "rev-parse", "HEAD");
		git(repository, "update-ref", "refs/remotes/origin/main", sha);

		const result = runScript(repository, ["resolve", "v1.2.4", sha]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("does not match package.json");
	});

	it("rejects a matching-version commit that is not an ancestor of origin/main", async () => {
		const directory = await scratchDirectory();
		const repository = await createRepository(directory, "1.2.3");
		const mainSha = git(repository, "rev-parse", "HEAD");
		git(repository, "update-ref", "refs/remotes/origin/main", mainSha);
		const branchSha = await commitPackage(repository, "2.0.0");

		const result = runScript(repository, ["resolve", "v2.0.0", branchSha]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("is not reachable from origin/main");
	});
});
