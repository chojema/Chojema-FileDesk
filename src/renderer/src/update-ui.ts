import { alertBox, busy, choose, isModalOpen } from './dialogs'
import { api, formatSize, t } from './util'

export async function showUpdate(quiet = false): Promise<void> {
  const checking = quiet ? null : busy(t('update.checking'))
  let result
  try { result = await api.checkUpdate() } finally { checking?.close() }
  if (!result.ok || !result.value) {
    if (!quiet) await alertBox(t('update.check'), result.error || '')
    return
  }
  const info = result.value
  if (quiet && isModalOpen()) return
  if (!info.available) {
    if (!quiet) await alertBox(t('update.check'), t('update.current', { current: info.current, latest: info.latest }))
    return
  }
  const choice = await choose({
    title: t('update.check'), message: `${t('update.available', { current: info.current, latest: info.latest })}\n\n${t(info.assetName ? 'update.installHint' : 'update.noAsset')}`,
    detail: info.notes, buttons: [
      { id: 'cancel', label: t('btn.cancel') }, { id: 'release', label: t('update.release') },
      ...(info.assetName ? [{ id: 'download', label: `${t('update.download')} · ${formatSize(info.size || 0)}`, kind: 'primary' as const }] : [])
    ], cancelId: 'cancel'
  })
  if (choice === 'release') { await api.openLink(info.url); return }
  if (choice !== 'download') return
  const downloading = busy(t('update.downloading'))
  const off = api.onUpdateProgress(p => downloading.update(`${formatSize(p.received)} / ${formatSize(p.total)}`, p.total ? p.received / p.total : 0))
  try {
    const file = await api.downloadUpdate()
    off(); downloading.close()
    await alertBox(t(file.ok ? 'update.check' : 'dlg.error.title'), file.ok ? t('update.opened') : file.error || '', file.ok ? file.value : undefined)
  } finally { off(); downloading.close() }
}
