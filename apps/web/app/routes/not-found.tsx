import { data } from 'react-router'
import { ErrorPage } from '../components/ErrorPage'

export function loader() {
  throw data(null, { status: 404 })
}

export default function NotFound() {
  return <ErrorPage status={404} />
}
