// server/routes/openfeed.routes.js — mounted at /api/openfeed
//
//   GET  /jwks.json        PUBLIC — the app's public key set (optional jwksUri)
//   GET  /status           setup/connection status + public JWKS
//   POST /keys             generate the app + DPoP keypairs ({ rotate: true } to replace)
//   POST /connect          start PAR; returns the openfeed sign-in URL
//   GET  /callback         OAuth redirect target
//   GET  /consent-return   back from openfeed's "share accounts" screen
//   POST /match-account    re-pick the Kutumb NAB account from the shared ones
//   POST /sync             pull credits now and reconcile all open events
//   POST /disconnect       forget tokens/grant (revoke the share at app.openfeed.au too)

import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import {
  ensureKeys,
  getPublicJwks,
  startAuthorization,
  handleCallback,
  handleConsentReturn,
  matchAccount,
  getStatus,
  disconnect,
} from "../lib/openfeedClient.js";
import { syncOpenfeed } from "../lib/openfeedSync.js";

const router = Router();

// The OAuth round trip must come back to THIS server, so use the address the
// admin is actually on (proxy-aware), not the saved Public Base URL.
function selfBaseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
  const host = String(req.get("x-forwarded-host") || req.get("host")).split(",")[0].trim();
  return `${proto}://${host}`;
}

function page(title, body, ok = true) {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px">
  <h2 style="color:${ok ? "#7c3f00" : "#b91c1c"}">${title}</h2><p>${body}</p>
  <p><a href="/admin">Back to admin</a></p></div>`;
}
const esc = (s) => String(s).replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch]);

router.get("/jwks.json", async (req, res) => {
  const jwks = await getPublicJwks();
  if (!jwks) return res.status(404).json({ message: "No keys generated yet" });
  res.json(jwks);
});

router.get("/status", requireAdmin, async (req, res) => {
  try {
    res.json({ ...(await getStatus()), baseUrl: selfBaseUrl(req) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/keys", requireAdmin, async (req, res) => {
  try {
    res.json({ jwks: await ensureKeys({ rotate: req.body?.rotate === true }) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/connect", requireAdmin, async (req, res) => {
  try {
    res.json({ url: await startAuthorization(selfBaseUrl(req)) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/callback", requireAdmin, async (req, res) => {
  try {
    if (req.query.error) throw new Error(`openfeed sign-in was not completed (${req.query.error_description || req.query.error}).`);
    const r = await handleCallback({
      code: String(req.query.code || ""),
      state: String(req.query.state || ""),
      iss: req.query.iss ? String(req.query.iss) : null,
      baseUrl: selfBaseUrl(req),
    });
    if (r.consentUrl) return res.redirect(r.consentUrl);
    const m = await matchAccount().catch(() => ({ matched: null }));
    res.send(page("NAB account connected", m.matched
      ? "The Kutumb NAB account is connected through openfeed. You can close this tab — transactions will be pulled and reconciled automatically."
      : "Connected to openfeed, but the Kutumb NAB account (BSB 082-356, account 778280517) wasn't among the shared accounts. Click Connect again and tick that account on openfeed's sharing screen."));
  } catch (err) {
    res.status(400).send(page("Couldn't connect to openfeed", esc(err.message), false));
  }
});

router.get("/consent-return", requireAdmin, async (req, res) => {
  try {
    if (req.query.consented !== "true") {
      throw new Error(`Sharing wasn't approved on openfeed${req.query.reason ? ` (${req.query.reason})` : ""}.`);
    }
    await handleConsentReturn({ grantId: req.query.grantId ? String(req.query.grantId) : null });
    const m = await matchAccount();
    res.send(page("NAB account connected", m.matched
      ? "The Kutumb NAB account is now shared with the website through openfeed. You can close this tab — new transfers will be pulled and reconciled automatically every 4 hours, or straight away with Sync now."
      : "Sharing is set up, but the Kutumb NAB account (BSB 082-356, account 778280517) wasn't among the accounts you shared. Click Connect again and tick that account."));
  } catch (err) {
    res.status(400).send(page("Couldn't finish connecting", esc(err.message), false));
  }
});

router.post("/match-account", requireAdmin, async (req, res) => {
  try {
    res.json(await matchAccount());
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/sync", requireAdmin, async (req, res) => {
  try {
    res.json(await syncOpenfeed({ admin: req.admin }));
  } catch (err) {
    console.error("OPENFEED SYNC ERROR:", err);
    res.status(400).json({ message: err.message });
  }
});

router.post("/disconnect", requireAdmin, async (req, res) => {
  await disconnect();
  res.json({ message: "Disconnected. Also revoke Kutumb's access in your openfeed dashboard (app.openfeed.au) if you no longer want it." });
});

export default router;
