/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // OKX-style dark palette: pure-black canvas, near-black panels, hairline
      // borders, muted green/red, and white as the primary action colour.
      colors: {
        bg: '#000000',
        panel: '#121212',
        panel2: '#1f1f1f',
        panel3: '#2b2b2b',
        border: '#262626',
        txt: '#f7f7f7',
        sub: '#8f8f8f',
        up: '#25a750',
        down: '#ca3f64',
        accent: '#5b8cff',
        gold: '#f0b90b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // numbers use the UI face with tabular figures (see index.css), like OKX
        mono: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-4px)' },
          '40%': { transform: 'translateX(4px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(3px)' },
        },
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '55%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        flash: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        rise: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        shake: 'shake 0.4s ease-in-out infinite',
        pop: 'pop 0.35s cubic-bezier(.2,1.4,.4,1)',
        flash: 'flash 0.7s ease-in-out infinite',
        rise: 'rise 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
