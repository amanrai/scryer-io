import express from "express";

const DEFAULT_API_PORT = 54322;
const port = Number(process.env.SCRYER_IO_API_PORT ?? DEFAULT_API_PORT);

const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/api/healthz", (_req, res) => {
	res.json({ ok: true, service: "scryer-io-api", port });
});

app.get("/api/runtime/providers", (_req, res) => {
	res.json({ providers: [] });
});

app.use("/api", (_req, res) => {
	res.status(404).json({ error: "Not found" });
});

app.listen(port, "127.0.0.1", () => {
	console.log(`Scryer Io API listening on http://127.0.0.1:${port}`);
});
