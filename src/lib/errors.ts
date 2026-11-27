// Turns the raw error text from the backend (or the network) into a short explanation and,
// when there is one, what the user can do about it. The raw text is still shown and copied.

import { tr } from './i18n'

export interface Explained {
  /** Short, plain explanation. */
  title: string
  /** What to do next, if anything. */
  hint?: string
}

interface Rule {
  test: RegExp
  explain: (m: RegExpMatchArray) => Explained
}

const RULES: Rule[] = [
  {
    test: /ANTIVIRUS: /,
    explain: () => ({
      title: tr('El antivirus bloqueó el archivo.', 'Your antivirus blocked the file.'),
      hint: tr('Mira Descargas para ver qué archivo fue. NATIVE HUB nunca desactiva el antivirus.', 'See Downloads for which file it was. NATIVE HUB never turns the antivirus off.'),
    }),
  },
  {
    test: /rate limit|HTTP 429|HTTP 403.*(api\.github|github)|cuota/i,
    explain: () => ({
      title: tr('GitHub ha limitado las consultas por ahora.', 'GitHub is limiting requests for now.'),
      hint: tr('Espera una hora o añade un token de GitHub en Ajustes (5.000 consultas por hora en vez de 60).', 'Wait an hour or add a GitHub token in Settings (5,000 requests per hour instead of 60).'),
    }),
  },
  {
    test: /dns|resolve|timed out|timeout|connection (refused|reset|closed)|network is unreachable|no route to host|os error 1100[0-9]|os error 10060|os error 10061|failed to lookup/i,
    explain: () => ({
      title: tr('No hay conexión con el servidor.', 'Could not reach the server.'),
      hint: tr('Comprueba tu conexión a internet y vuelve a intentarlo.', 'Check your internet connection and try again.'),
    }),
  },
  {
    test: /certificate|tls|ssl/i,
    explain: () => ({
      title: tr('La conexión segura no se pudo verificar.', 'The secure connection could not be verified.'),
      hint: tr('Suele deberse a un proxy o un antivirus que inspecciona HTTPS. NATIVE HUB no descarga sin una conexión verificada.', 'Usually a proxy or an antivirus inspecting HTTPS. NATIVE HUB does not download without a verified connection.'),
    }),
  },
  {
    test: /SHA-256|sha256/i,
    explain: () => ({
      title: tr('El archivo descargado no coincide con el publicado.', 'The downloaded file does not match the published one.'),
      hint: tr('Se ha borrado por seguridad. Vuelve a descargarlo; si se repite, avisa al proyecto.', 'It was deleted for safety. Download it again; if it happens again, tell the project.'),
    }),
  },
  {
    test: /os error 112|no space|espacio/i,
    explain: () => ({
      title: tr('No queda espacio en el disco.', 'The disk is full.'),
      hint: tr('Libera espacio o elige otra carpeta de juegos en Ajustes.', 'Free some space or choose another games folder in Settings.'),
    }),
  },
  {
    test: /os error 32|being used by another process|en uso/i,
    explain: () => ({
      title: tr('Otro programa está usando el archivo.', 'Another program is using the file.'),
      hint: tr('Cierra el juego (y su lanzador) y vuelve a intentarlo.', 'Close the game (and its launcher) and try again.'),
    }),
  },
  {
    test: /os error 5\b|access is denied|permission denied|acceso denegado/i,
    explain: () => ({
      title: tr('Windows no deja escribir en esa carpeta.', 'Windows does not allow writing to that folder.'),
      hint: tr('Elige una carpeta de juegos dentro de tu usuario (por ejemplo Documentos) en Ajustes.', 'Choose a games folder inside your user folder (for example Documents) in Settings.'),
    }),
  },
  {
    test: /os error (2|3)\b|cannot find the (file|path)|no such file/i,
    explain: () => ({
      title: tr('Falta un archivo o una carpeta.', 'A file or folder is missing.'),
      hint: tr('Puede que se haya movido o borrado fuera de NATIVE HUB. En Biblioteca puedes cambiar el ejecutable o reinstalar.', 'It may have been moved or deleted outside NATIVE HUB. In Library you can change the executable or reinstall.'),
    }),
  },
  {
    test: /host no permitido|host not allowed|not inside|fuera del repositorio|outside the repository/i,
    explain: () => ({
      title: tr('NATIVE HUB no descarga desde ese sitio.', 'NATIVE HUB does not download from that site.'),
      hint: tr('Solo se descargan releases oficiales del propio repositorio del proyecto.', 'Only official releases from the project’s own repository are downloaded.'),
    }),
  },
  {
    test: /catálogo no válido|invalid catalog/i,
    explain: () => ({
      title: tr('El catálogo descargado no es válido y se ha descartado.', 'The downloaded catalog is not valid and was discarded.'),
      hint: tr('Sigues con el catálogo que tenías. Se volverá a intentar más tarde.', 'You keep the catalog you had. It will be tried again later.'),
    }),
  },
]

/** Explanation of an error message, or null if there is nothing better than the raw text. */
export function explainError(raw: string): Explained | null {
  for (const r of RULES) {
    const m = raw.match(r.test)
    if (m) return r.explain(m)
  }
  return null
}

/** Error text from anything thrown (Tauri rejects with a plain string). */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}
