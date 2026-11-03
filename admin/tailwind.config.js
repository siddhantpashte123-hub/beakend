/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0066FF',
          50: '#EBF3FF',
          100: '#D6E6FF',
          200: '#ADCFFF',
          300: '#85B8FF',
          400: '#3D8BFF',
          500: '#0066FF',
          600: '#0052CC',
          700: '#003D99',
          800: '#002966',
          900: '#001433',
        },
      },
    },
  },
  plugins: [],
};
