/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: "#16181d",
        panel: "#202329",
        accent: "#df5b43"
      }
    }
  },
  plugins: []
};
