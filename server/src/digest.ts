import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export type ProfileFields = {
  tagline: string;
  description: string;
  persona: string;
  prospectus: string;
  website: string;
  emoji: string;
};

/** Same digest on client and server so the creator's signature covers the exact content. */
export function profileDigest(p: ProfileFields): string {
  const canonical = JSON.stringify([p.tagline, p.description, p.persona, p.prospectus, p.website, p.emoji]);
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}
