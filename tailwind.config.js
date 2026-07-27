/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: "var(--color-ink)",
        panel: "var(--color-panel)",
        toolbar: "var(--color-toolbar)",
        workspace: "var(--color-workspace)",
        accent: "#df5b43"
      }
    }
  },
  plugins: []
};
