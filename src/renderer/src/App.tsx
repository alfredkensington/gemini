import { useEffect, useState } from 'react'
import iconPng from './icon.png'

export default function App(): JSX.Element {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return window.electronAPI.onLoadingChanged((isLoading) => {
      setLoading(isLoading)
    })
  }, [])

  return (
    <div className="root">
      <div className={`loader ${loading ? 'loader--visible' : 'loader--hidden'}`}>
        <img src={iconPng} className="loader__icon" alt="" />
      </div>
    </div>
  )
}
