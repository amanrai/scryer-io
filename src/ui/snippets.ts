export type SnippetCell = {
	kind: "code" | "markdown" | "mermaid";
	title: string;
	content: string;
};

export type Snippet = {
	id: string;
	name: string;
	createdBy: "human" | "agent";
	cells: SnippetCell[];
	createdAt: string;
	updatedAt: string;
};

export type SnippetDraft = {
	name: string;
	cells: SnippetCell[];
	createdBy?: "human" | "agent";
};

async function parseError(res: Response): Promise<never> {
	const json = await res.json().catch(() => undefined);
	throw new Error(json?.error ?? `Request failed (${res.status})`);
}

export async function listSnippets(): Promise<Snippet[]> {
	const res = await fetch("/api/snippets");
	if (!res.ok) await parseError(res);
	const json = await res.json();
	return json.snippets ?? [];
}

export async function createSnippet(draft: SnippetDraft): Promise<Snippet> {
	const res = await fetch("/api/snippets", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(draft),
	});
	if (!res.ok) await parseError(res);
	return (await res.json()).snippet;
}

export async function updateSnippet(id: string, patch: Partial<SnippetDraft>): Promise<Snippet> {
	const res = await fetch(`/api/snippets/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!res.ok) await parseError(res);
	return (await res.json()).snippet;
}

export async function deleteSnippet(id: string): Promise<void> {
	const res = await fetch(`/api/snippets/${id}`, { method: "DELETE" });
	if (!res.ok) await parseError(res);
}
