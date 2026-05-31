import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light'|'dark'>(() => (localStorage.getItem('theme') as 'light'|'dark') || 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  return (
    <button className="btn-secondary" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title="Toggle theme">
      {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
    </button>
  )
}

