import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const indexPath = path.join(dist, "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("Production build is missing dist/index.html.");
  process.exit(1);
}

const html = fs.readFileSync(indexPath, "utf8");
const references = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi)]
  .map((match) => match[1].split("?")[0])
  .filter((reference) => !/^[a-z]+:\/\//i.test(reference));
const scripts = references.filter((reference) => reference.endsWith(".js"));
const missing = references.filter((reference) => !fs.existsSync(path.join(dist, reference.replace(/^\//, ""))));

if (!scripts.length || missing.length) {
  console.error("Production build is incomplete or stale.");
  if (!scripts.length) console.error("No JavaScript bundle is referenced by dist/index.html.");
  for (const reference of missing) console.error(`Missing build asset: ${reference}`);
  process.exit(1);
}

console.log(`Production build is ready (${scripts.length} JavaScript bundle${scripts.length === 1 ? "" : "s"}; ${references.length - scripts.length} stylesheet${references.length - scripts.length === 1 ? "" : "s"}).`);
