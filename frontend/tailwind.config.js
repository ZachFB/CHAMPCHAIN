/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        turf: {
          DEFAULT: "#080F0A",
          mid:     "#0E1F13",
          light:   "#101F14",
          line:    "#172E1C",
        },
        chalk: "#F0EDE4",
        mist:  "#687A6E",
        haze:  "#7C9184",
        gold: {
          DEFAULT: "#F5B731",
          dim:     "#C89020",
        },
        red: {
          DEFAULT: "#E8384A",
          dim:     "#A02030",
        },
        card: {
          yes: "#F5B731",
          no:  "#E8384A",
        },
      },
      fontFamily: {
        display: ["Anton", "Impact", "sans-serif"],
        body:    ["Inter", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "monospace"],
      },
      keyframes: {
        ticker: {
          from: { transform: "translateX(0)" },
          to:   { transform: "translateX(-50%)" },
        },
        pulse2: {
          "0%,100%": { opacity: 1 },
          "50%":     { opacity: 0.4 },
        },
        fadeUp: {
          from: { opacity: 0, transform: "translateY(20px)" },
          to:   { opacity: 1, transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to:   { backgroundPosition: "200% 0" },
        },
        scanline: {
          from: { top: "0%" },
          to:   { top: "100%" },
        },
        floatBall: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%":      { transform: "translateY(-16px) rotate(180deg)" },
        },
        spinSlow: {
          from: { transform: "rotate(0deg)" },
          to:   { transform: "rotate(360deg)" },
        },
        feedIn: {
          from: { opacity: 0, transform: "translateY(-10px)" },
          to:   { opacity: 1, transform: "translateY(0)" },
        },
        cardGlow: {
          "0%, 100%": { boxShadow: "0 0 0px rgba(245,183,49,0)" },
          "50%":      { boxShadow: "0 0 28px rgba(245,183,49,0.18)" },
        },
      },
      animation: {
        ticker:    "ticker 32s linear infinite",
        pulse2:    "pulse2 2s ease-in-out infinite",
        fadeUp:    "fadeUp 0.6s ease forwards",
        shimmer:   "shimmer 2.5s linear infinite",
        scanline:  "scanline 4s linear infinite",
        floatBall: "floatBall 6s ease-in-out infinite",
        spinSlow:  "spinSlow 14s linear infinite",
        feedIn:    "feedIn 0.35s ease forwards",
        cardGlow:  "cardGlow 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
