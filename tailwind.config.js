/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0e11',
        panel: '#161a1e',
        panel2: '#1e2329',
        border: '#2b3139',
        txt: '#eaecef',
        sub: '#848e9c',
        up: '#00E676',
        down: '#FF5252',
        accent: '#3b82f6',
        gold: '#f0b90b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
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
