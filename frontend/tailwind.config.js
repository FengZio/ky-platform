/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#f8f9ff",
        surface: "#f8f9ff",
        "surface-dim": "#d1dbec",
        "surface-bright": "#f8f9ff",
        "surface-lowest": "#ffffff",
        "surface-low": "#eef4ff",
        "surface-base": "#e5eeff",
        "surface-high": "#dfe9fa",
        "surface-highest": "#d9e3f4",
        "surface-variant": "#d9e3f4",
        outline: "#737686",
        "outline-variant": "#c3c5d7",
        primary: {
          DEFAULT: "#003fb1",
          50: "#eef4ff",
          100: "#dbe7ff",
          200: "#b5c9ff",
          300: "#8faeff",
          400: "#5f86ef",
          500: "#1a56db",
          600: "#003fb1",
          700: "#00318a",
          800: "#002563",
          900: "#00174d",
        },
        secondary: {
          DEFAULT: "#fed01b",
          50: "#fff7d6",
          100: "#ffe083",
          200: "#fed01b",
          700: "#735c00",
        },
        tertiary: {
          DEFAULT: "#0e9f6e",
          50: "#def7ec",
          100: "#81f9c1",
          700: "#005438",
        },
        error: {
          DEFAULT: "#ba1a1a",
          50: "#ffdad6",
          700: "#93000a",
        },
        success: {
          DEFAULT: "#0e9f6e",
          50: "#def7ec",
          700: "#046c4e",
        },
        warning: {
          DEFAULT: "#f59e0b",
          50: "#fff7d6",
          700: "#9a5b00",
        },
        info: {
          DEFAULT: "#1a56db",
          50: "#eef4ff",
          700: "#00318a",
        },
        foreground: {
          DEFAULT: "#121c28",
          muted: "#434654",
          inverse: "#eaf1ff",
        },
      },
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
      },
      boxShadow: {
        workbench: "0 2px 8px rgba(18, 28, 40, 0.05)",
        float: "0 8px 24px rgba(18, 28, 40, 0.1)",
      },
      fontFamily: {
        sans: ['Inter', '"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
      },
      spacing: {
        18: "4.5rem",
      },
      maxWidth: {
        workbench: "1440px",
      },
    },
  },
  plugins: [],
};
