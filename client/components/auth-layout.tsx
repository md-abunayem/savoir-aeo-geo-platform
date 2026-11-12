import Link from "next/link";
import { ArrowUpRight, ScanLine, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./auth-layout.module.css";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={`login-page ${styles.shell}`}>
      <section className="login-story" aria-label="About Savoir">
        <Link className="brand" href="/" aria-label="Savoir home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          savoir<span>.</span>
        </Link>
        <div className={styles.storyContent}>
          <p className="eyebrow">
            <span className={styles.dot} /> A CLEARER VIEW OF AI SEARCH
          </p>
          <h1>
            Your brand.
            <br />
            Their question.
            <br />
            <em>The answer.</em>
          </h1>
          <p>
            See how AI discovers, understands and recommends your brand. Make
            your next move with clarity.
          </p>
          <div
            className={styles.preview}
            aria-label="An illustration of AI answer monitoring"
          >
            <div className={styles.previewTop}>
              <span>
                <ScanLine size={16} /> ANSWER INTELLIGENCE
              </span>
              <span className={styles.example}>PREVIEW</span>
            </div>
            <div className={styles.question}>
              Where does your brand show up?
            </div>
            <div className={styles.answer}>
              <Sparkles size={19} />
              <div>
                <strong>Go beyond the search results.</strong>
                <p>
                  Understand the answers. Find the sources.
                  <br />
                  See the opportunities.
                </p>
              </div>
            </div>
            <div className={styles.previewBottom}>
              <span>From answers to action</span>
              <ArrowUpRight size={18} />
            </div>
          </div>
        </div>
        <div className={styles.storyFooter}>
          <span>Built for the way people search now.</span>
          <span>Clarity, by Savoir.</span>
        </div>
      </section>
      <section className="login-form" aria-label="Your Savoir account">
        <div className="login-card">{children}</div>
        <p className="login-footer">Savoir &middot; Your brand, understood.</p>
      </section>
    </main>
  );
}
