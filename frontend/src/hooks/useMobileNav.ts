import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

export function useMobileNav() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  return { mobileNavOpen, setMobileNavOpen }
}
