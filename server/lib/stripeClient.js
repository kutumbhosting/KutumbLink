import Stripe from "stripe";
import { getSetting } from "./settings.js";

let cached = null;
let cachedKey = null;

export async function getStripe() {
  const key = await getSetting("stripe_secret_key");
  if (!key) return null;
  if (cached && cachedKey === key) return cached;
  cached = new Stripe(key);
  cachedKey = key;
  return cached;
}
