/**
 * Scrolling ticker — gold borders, dark background, smooth animation.
 * Items are duplicated for a seamless, jump-free loop.
 */
export default function ProofTicker({ items }) {
  const doubled = [...items, ...items];
  return (
    <div style={{
      borderTop:    "1px solid rgba(245,183,49,0.18)",
      borderBottom: "1px solid rgba(245,183,49,0.18)",
      background:   "rgba(5,11,7,0.92)",
      overflow:     "hidden",
      padding:      "10px 0",
      userSelect:   "none",
      position:     "relative",
      zIndex:       10,
    }}>
      {/* Fade left */}
      <div style={{
        position:"absolute",left:0,top:0,bottom:0,width:80,
        background:"linear-gradient(90deg,rgba(5,11,7,.95),transparent)",
        zIndex:2,pointerEvents:"none",
      }}/>
      {/* Fade right */}
      <div style={{
        position:"absolute",right:0,top:0,bottom:0,width:80,
        background:"linear-gradient(270deg,rgba(5,11,7,.95),transparent)",
        zIndex:2,pointerEvents:"none",
      }}/>

      <div className="ticker-track">
        {doubled.map((item, i) => (
          <span key={i} style={{
            fontFamily:    '"JetBrains Mono", monospace',
            fontSize:      "10px",
            color:         "var(--mist)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            margin:        "0 52px",
            display:       "inline-flex",
            alignItems:    "center",
            gap:           "10px",
            whiteSpace:    "nowrap",
          }}>
            <span style={{
              color:      "var(--gold)",
              fontSize:   "8px",
              opacity:    0.8,
              flexShrink: 0,
            }}>✦</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
