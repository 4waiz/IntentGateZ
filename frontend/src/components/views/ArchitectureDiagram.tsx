/** Static architecture diagram of the request path (labels only; no runtime claims). */
export function ArchitectureDiagram({ onZ, model }: { onZ: boolean; model: string | null }) {
  const host = onZ ? `IBM LinuxONE · s390x${model ? ` · ${model}` : ""}` : "Host reported by /api/platform (not IBM Z)";
  const stages = ["Identity", "Policy", "Features", "ML risk", "Audit"];
  return (
    <svg viewBox="0 0 1180 260" className="h-auto w-full" role="img" aria-label="IntentGate Z architecture">
      <defs>
        <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#8496A8" />
        </marker>
        <linearGradient id="gw" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0F62FE" stopOpacity="0.16" />
          <stop offset="1" stopColor="#00D5B5" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* operator */}
      <g>
        <rect x="10" y="92" width="132" height="76" rx="6" fill="#0C1A28" stroke="rgba(132,150,168,0.35)" />
        <text x="76" y="122" textAnchor="middle" fill="#E8F0F7" fontSize="14" fontWeight="600" fontFamily="IBM Plex Sans">Operator</text>
        <text x="76" y="142" textAnchor="middle" fill="#8496A8" fontSize="11" fontFamily="IBM Plex Sans">human intent</text>
        <text x="76" y="157" textAnchor="middle" fill="#8496A8" fontSize="11" fontFamily="IBM Plex Sans">(signed, versioned)</text>
      </g>
      <line x1="146" y1="130" x2="206" y2="130" stroke="#8496A8" strokeWidth="1.4" markerEnd="url(#arw)" />
      <text x="176" y="121" textAnchor="middle" fill="#00D5B5" fontSize="10.5" fontFamily="IBM Plex Mono">intent</text>

      {/* agent */}
      <g>
        <rect x="210" y="92" width="132" height="76" rx="6" fill="#0C1A28" stroke="rgba(132,150,168,0.35)" />
        <text x="276" y="122" textAnchor="middle" fill="#E8F0F7" fontSize="14" fontWeight="600" fontFamily="IBM Plex Sans">AI agent</text>
        <text x="276" y="142" textAnchor="middle" fill="#8496A8" fontSize="11" fontFamily="IBM Plex Sans">valid credentials,</text>
        <text x="276" y="157" textAnchor="middle" fill="#8496A8" fontSize="11" fontFamily="IBM Plex Sans">proposes tool calls</text>
      </g>
      <line x1="346" y1="130" x2="404" y2="130" stroke="#8496A8" strokeWidth="1.4" markerEnd="url(#arw)" />
      <text x="375" y="121" textAnchor="middle" fill="#4589FF" fontSize="10.5" fontFamily="IBM Plex Mono">proposal</text>

      {/* gateway */}
      <g>
        <rect x="408" y="30" width="472" height="200" rx="8" fill="url(#gw)" stroke={onZ ? "#00D5B5" : "#4589FF"} strokeOpacity="0.7" />
        <text x="428" y="56" fill="#E8F0F7" fontSize="15" fontWeight="600" fontFamily="IBM Plex Sans" letterSpacing="1.5">INTENTGATE Z GATEWAY</text>
        <text x="428" y="75" fill={onZ ? "#00D5B5" : "#FFBC5C"} fontSize="11" fontFamily="IBM Plex Mono">{host}</text>
        {stages.map((s, i) => (
          <g key={s}>
            <rect x={428 + i * 88} y="98" width="78" height="54" rx="4" fill="#07111C" stroke="rgba(132,150,168,0.35)" />
            <text x={467 + i * 88} y="122" textAnchor="middle" fill="#E8F0F7" fontSize="12" fontWeight="500" fontFamily="IBM Plex Sans">
              {s}
            </text>
            <text x={467 + i * 88} y="140" textAnchor="middle" fill="#8496A8" fontSize="9.5" fontFamily="IBM Plex Mono">
              {["agent + tool", "hard rules", "context signals", "risk model", "SHA-256 chain"][i]}
            </text>
            {i < stages.length - 1 && <line x1={506 + i * 88} y1="125" x2={516 + i * 88} y2="125" stroke="#8496A8" strokeWidth="1.2" markerEnd="url(#arw)" />}
          </g>
        ))}
        <text x="428" y="184" fill="#8496A8" fontSize="11" fontFamily="IBM Plex Sans">Hard policy decides; the ML model can escalate but never relax a verdict.</text>
        <text x="428" y="203" fill="#8496A8" fontSize="11" fontFamily="IBM Plex Sans">Every proposal, decision and outcome is appended to the tamper-evident audit chain.</text>
      </g>

      {/* verdicts */}
      {[
        { y: 52, c: "#00D5B5", t: "ALLOW", s: "executed" },
        { y: 112, c: "#FFBC5C", t: "CHALLENGE", s: "held for supervisor" },
        { y: 172, c: "#FF5D70", t: "BLOCK", s: "prevented" },
      ].map((v) => (
        <g key={v.t}>
          <line x1="884" y1="130" x2="930" y2={v.y + 18} stroke={v.c} strokeOpacity="0.6" strokeWidth="1.3" markerEnd="url(#arw)" />
          <rect x="934" y={v.y} width="116" height="36" rx="4" fill="#0C1A28" stroke={v.c} strokeOpacity="0.8" />
          <text x="992" y={v.y + 16} textAnchor="middle" fill={v.c} fontSize="12" fontWeight="600" fontFamily="IBM Plex Sans" letterSpacing="1.4">
            {v.t}
          </text>
          <text x="992" y={v.y + 29} textAnchor="middle" fill="#8496A8" fontSize="9.5" fontFamily="IBM Plex Sans">
            {v.s}
          </text>
        </g>
      ))}
      <line x1="1054" y1="70" x2="1086" y2="118" stroke="#00D5B5" strokeOpacity="0.6" strokeWidth="1.3" markerEnd="url(#arw)" />
      <g>
        <rect x="1088" y="100" width="86" height="60" rx="6" fill="#0C1A28" stroke="rgba(132,150,168,0.35)" />
        <text x="1131" y="126" textAnchor="middle" fill="#E8F0F7" fontSize="12" fontWeight="600" fontFamily="IBM Plex Sans">Simulated</text>
        <text x="1131" y="142" textAnchor="middle" fill="#E8F0F7" fontSize="12" fontWeight="600" fontFamily="IBM Plex Sans">tools</text>
      </g>
    </svg>
  );
}
