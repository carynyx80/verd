"use client";
import bs58 from "bs58";
import { profileDigest, type ProfileFields } from "./digest";
import { api, profileMessage } from "./stewra";

/** Creator signs the exact profile content; the server checks it against the on-chain creator. */
export async function publishProfile(
  launch: string,
  fields: ProfileFields,
  signMessage: ((m: Uint8Array) => Promise<Uint8Array>) | undefined
) {
  if (!signMessage) throw new Error("Your wallet can't sign messages. Try Phantom, Backpack or Solflare.");
  const digest = profileDigest(fields);
  const sig = await signMessage(new TextEncoder().encode(profileMessage(launch, digest)));
  const res = await fetch(api("/api/agents"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ launch, ...fields, signature: bs58.encode(sig) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not save profile");
  return data;
}
