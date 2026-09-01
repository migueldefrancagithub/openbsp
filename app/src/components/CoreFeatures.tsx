import "../app/core-features.css";

export function CoreFeatures() {
  return (
    <section className="c1-section">
      <div className="c1-container">
        <div className="c1-badge">Core Platform</div>
        <h2 className="c1-title">Inbox, broadcasts, compliance.</h2>
        <p className="c1-subtitle">
          Three pillars another platform sells separately.
          <br />
          Here they ship together — and were designed to compose.
        </p>

        <div className="c1-grid">
          {/* Card 1 — Real-time inbox */}
          <div className="c1-card c1-card-1">
            <div className="c1-chat">
              <div className="c1-bubble c1-bubble-in">
                Olá, posso confirmar a consulta amanhã?
              </div>
              <div className="c1-bubble c1-bubble-typing">
                <span className="c1-typing-dot" />
                <span className="c1-typing-dot" />
                <span className="c1-typing-dot" />
              </div>
              <div className="c1-bubble c1-bubble-out">
                Confirmado! Quarta às 10h
                <span className="c1-tick">✓✓</span>
              </div>
            </div>
            <div className="c1-card-meta">
              <h3>Real-time inbox</h3>
              <p className="c1-card-desc">
                Conversations stream in via Convex reactive subscriptions.
                No polling, no refresh.
              </p>
            </div>
          </div>

          {/* Card 2 — Smart broadcasts */}
          <div className="c1-card c1-card-2">
            <div className="c1-broadcast">
              <div className="c1-broadcast-row">
                <span className="c1-broadcast-title">
                  appointment_reminder
                </span>
                <span className="c1-quality-pill">
                  <span className="c1-quality-dot" />
                  Quality green
                </span>
              </div>
              <div className="c1-progress-track">
                <div className="c1-progress-fill" />
              </div>
              <div className="c1-broadcast-counts">
                <div className="c1-count-tile">
                  <div className="c1-count-num c1-count-num-anim-1">214</div>
                  <div className="c1-count-label">Sent</div>
                </div>
                <div className="c1-count-tile">
                  <div className="c1-count-num c1-count-num-anim-2">198</div>
                  <div className="c1-count-label">Delivered</div>
                </div>
                <div className="c1-count-tile">
                  <div className="c1-count-num c1-count-num-anim-3">141</div>
                  <div className="c1-count-label">Read</div>
                </div>
              </div>
              <div className="c1-broadcast-row">
                <span className="c1-comp-meta">3 skipped (opt-out)</span>
                <span className="c1-comp-meta">12 replies tracked</span>
              </div>
            </div>
            <div className="c1-card-meta">
              <h3>Smart broadcasts</h3>
              <p className="c1-card-desc">
                Quality-aware throttle. Auto-pause when rating drops to red.
              </p>
            </div>
          </div>

          {/* Card 3 — Consent + audit feed */}
          <div className="c1-card c1-card-3">
            <div className="c1-compliance">
              <div className="c1-comp-row">
                <span className="c1-comp-icon">✓</span>
                <span className="c1-comp-text">Marketing consent granted</span>
                <span className="c1-comp-meta">form_web_v3</span>
              </div>
              <div className="c1-comp-row">
                <span className="c1-comp-icon">✓</span>
                <span className="c1-comp-text">Transactional auto-recorded</span>
                <span className="c1-comp-meta">inbound msg</span>
              </div>
              <div className="c1-comp-row">
                <span className="c1-comp-icon">✓</span>
                <span className="c1-comp-text">STOP keyword → revoke</span>
                <span className="c1-comp-meta">webhook</span>
              </div>
              <div className="c1-comp-row">
                <span className="c1-comp-icon c1-comp-icon-shield">⛨</span>
                <span className="c1-comp-text">Audit hash chain intact</span>
                <span className="c1-comp-meta">2,481 events</span>
              </div>
            </div>
            <div className="c1-card-meta">
              <h3>Consent + audit</h3>
              <p className="c1-card-desc">
                Append-only audit log. Per-purpose, per-channel consent vector.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
