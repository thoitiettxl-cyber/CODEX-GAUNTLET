const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
	throw new Error(`pi-router requires Node.js >=22.19.0; found ${process.versions.node}`);
}

await import("./cli.js");
