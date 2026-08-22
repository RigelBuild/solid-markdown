<p>
  <img width="100%" src="https://assets.solidjs.com/banner?type=solid-markdown&background=tiles&project=%20" alt="solid-markdown">
</p>

# `solid-markdown`

Render markdown to Solid components.

`solid-markdown` now tracks the `react-markdown` 10.x API closely and keeps the rendering pipeline upstream-aligned while adapting the JSX output to Solid.

## Why this update matters

This package is now a real Solid port of modern `react-markdown`, not a compatibility wrapper around older behavior. The public API matches upstream concepts such as `components`, `remarkRehypeOptions`, `urlTransform`, and async plugin support, while Solid gets one extra client-side helper: `MarkdownResource`.

## Installation

```bash
bun add @rigelbuild/solid-markdown
```

## Usage

```tsx
import Markdown from "@rigelbuild/solid-markdown";
import remarkGfm from "remark-gfm";

const markdown = `
# This is a title

- here's
- a
- list
`;

export default function App() {
	return <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>;
}
```

## API reference

| Export | Type | Purpose |
| --- | --- | --- |
| `Markdown` | component | Synchronous markdown renderer. |
| `MarkdownAsync` | function | Async/server renderer for async unified plugins. |
| `MarkdownResource` | component | Solid client wrapper for async plugin pipelines. |
| `defaultUrlTransform` | function | Default URL sanitizer used for links and images. |
| `AllowElement` | type | Per-element allow/deny callback. |
| `Components` | type | Custom tag-to-component overrides. |
| `ExtraProps` | type | Extra props passed to custom components (`node`). |
| `Options` | type | Shared renderer options. |
| `MarkdownResourceOptions` | type | `Options` plus `fallback`. |
| `UrlTransform` | type | URL rewrite/sanitization hook. |

### `Markdown`

Synchronous markdown renderer.

```tsx
import Markdown from "@rigelbuild/solid-markdown";
import remarkGfm from "remark-gfm";

<Markdown remarkPlugins={[remarkGfm]}>{value()}</Markdown>;
```

### `MarkdownAsync`

Async/server helper for async unified plugins.

```tsx
import { MarkdownAsync } from "@rigelbuild/solid-markdown";
import rehypeStarryNight from "rehype-starry-night";

const content = await MarkdownAsync({
	children: "```js\nconsole.log(3.14)\n```",
	rehypePlugins: [rehypeStarryNight],
});

return <div class="preview">{content}</div>;
```

### `MarkdownResource`

Solid-native client wrapper for async plugins.

```tsx
import { MarkdownResource } from "@rigelbuild/solid-markdown";
import rehypeStarryNight from "rehype-starry-night";

<MarkdownResource
	children={value()}
	fallback={<p>Rendering…</p>}
	rehypePlugins={[rehypeStarryNight]}
/>;
```

### `defaultUrlTransform`

By default, unsafe protocols such as `javascript:` are removed while standard URLs, fragments, and paths are preserved.

```tsx
import Markdown, { defaultUrlTransform } from "@rigelbuild/solid-markdown";

<Markdown
	urlTransform={(url, key, node) => {
		const safe = defaultUrlTransform(url);
		if (!safe) return safe;
		return key === "href" && node.tagName === "a" ? `/out?url=${encodeURIComponent(safe)}` : safe;
	}}
>
	{"[OpenAI](https://openai.com)"}
</Markdown>;
```

## Options

Supported options match upstream `react-markdown` 10.x semantics:

| Option | Purpose |
| --- | --- |
| `allowElement` | Decide per HAST element whether it should render. |
| `allowedElements` | Allowlist tag names. |
| `children` | Markdown source string. `null` and `undefined` render nothing. |
| `components` | Override specific HTML tags with Solid components or tag names. |
| `disallowedElements` | Blocklist tag names. |
| `rehypePlugins` | Rehype plugins applied after markdown is converted to HAST. |
| `remarkPlugins` | Remark plugins applied while parsing markdown. |
| `remarkRehypeOptions` | Extra `remark-rehype` options merged with the safe defaults used by upstream. |
| `skipHtml` | Ignore raw HTML in the markdown source. |
| `unwrapDisallowed` | Keep children of removed nodes instead of dropping the whole subtree. |
| `urlTransform` | Rewrite or sanitize link and image URLs. |

## Components

Custom components receive normal Solid intrinsic props plus `node`.

```tsx
import Markdown, { type Components } from "@rigelbuild/solid-markdown";

const components: Components = {
	code(props) {
		return <code data-tag={props.node?.tagName}>{props.children}</code>;
	},
};

<Markdown components={components}>{"`example`"}</Markdown>;
```

## Migration

### Default import

Before:

```tsx
import { SolidMarkdown } from "@rigelbuild/solid-markdown";

<SolidMarkdown children={markdown} />;
```

After:

```tsx
import Markdown from "@rigelbuild/solid-markdown";

<Markdown>{markdown}</Markdown>;
```

### Wrapper ownership

Before:

```tsx
<Markdown class="markdown-body">{markdown}</Markdown>;
```

After:

```tsx
<div class="markdown-body">
	<Markdown>{markdown}</Markdown>
</div>
```

### URL transforms

Before:

```tsx
<Markdown transformLinkUri={(href) => href} transformImageUri={(src) => src}>
	{markdown}
</Markdown>;
```

After:

```tsx
<Markdown
	urlTransform={(url, key) => {
		if (key === "href") return url;
		if (key === "src") return url;
		return url;
	}}
>
	{markdown}
</Markdown>;
```

### Removed and deprecated behavior

- `SolidMarkdown` is gone. Use the default export instead.
- Wrapper props such as `class` and `className` are gone. Wrap `Markdown` in your own element.
- Legacy pre-v9 props now throw at runtime instead of being silently accepted. This includes deprecated names such as `source`, `plugins`, `renderers`, `allowNode`, `allowedTypes`, `disallowedTypes`, `transformLinkUri`, `transformImageUri`, `linkTarget`, and the old source-position props.
- `urlTransform` replaces `transformLinkUri` and `transformImageUri`.
- `renderingStrategy="memo" | "reconcile"` is a supported, Solid-specific prop on the synchronous `Markdown` export. This fork keeps it un-deprecated: `"reconcile"` is load-bearing for streaming DOM stability (it rebuilds the subtree each tick so growing content stays consistent), and consumers rely on it permanently.

## Testing and status

Local verification for this port currently runs through:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Current status:

- Sync rendering is supported through `Markdown`.
- Async unified plugins are supported on the server through `MarkdownAsync`.
- Async unified plugins are supported on the client through `MarkdownResource`.
- SSR and DOM behavior are covered by the package test suite.
