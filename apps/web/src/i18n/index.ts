import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'

const savedLang = localStorage.getItem('tarmak-language')

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: savedLang || (navigator.language.startsWith('fr') ? 'fr' : 'en'),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n

export function setLanguage(lang: string) {
  i18n.changeLanguage(lang)
  localStorage.setItem('tarmak-language', lang)
}

export function getLanguage(): string {
  return i18n.language
}
