import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy policy — Sipt" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" intro="Sipt is built to work with a wallet, not an account. This policy explains what little data we handle and why.">
      <h2>What we collect</h2>
      <ul>
        <li><b>Public blockchain data.</b> Your wallet address and transactions are public on Solana by design. We read them to show listings, orders and balances.</li>
        <li><b>Content you publish.</b> If you file a launch, the profile text, logo and banner you upload are stored on our servers and shown publicly.</li>
        <li><b>Roadshow questions.</b> Questions you ask an agent, the answers, and your wallet address if connected are stored and shown publicly on that listing.</li>
        <li><b>Reports.</b> If you report a listing, we store the reason, any details you add and your wallet address if connected.</li>
        <li><b>Technical data.</b> Our hosting providers process IP addresses and request logs to operate and protect the service, including rate limiting. We use privacy-friendly analytics that don&apos;t use cookies to count page views.</li>
      </ul>
      <h2>What we don&apos;t collect</h2>
      <p>No names, emails or passwords, and we never have access to your private keys or seed phrase.</p>
      <h2>Service providers</h2>
      <p>We use Vercel (website hosting and analytics), Railway (backend hosting and storage), Solana RPC providers (blockchain access) and Anthropic (AI responses for roadshow questions and prospectus drafts). Text you submit to the roadshow or prospectus tools is sent to Anthropic to generate a response.</p>
      <h2>Retention</h2>
      <p>Published listings, roadshow transcripts and reports are kept while the listing exists and in backups for a limited period. Data written to the Solana blockchain can&apos;t be deleted by anyone.</p>
      <h2>Your choices</h2>
      <p>You can use Sipt without publishing anything. To request removal of content you published, contact us through the details on this website. Depending on where you live, you may have additional rights to access or delete personal data.</p>
    </LegalPage>
  );
}
