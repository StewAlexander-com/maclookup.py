/* Static, offline-first i18n for the MAC Vendor Lookup PWA.
 *
 * Design constraints (per project guidance):
 *   - No runtime translation service. All strings are bundled.
 *   - Only translates UI chrome; IEEE vendor/address data stays as-is.
 *   - Auto-detects from navigator.languages / navigator.language, plus an
 *     explicit user selector. Falls back to English when a locale isn't
 *     supported or detection fails.
 *   - Persistence is best-effort: tries localStorage (cheap, fine here since
 *     the project already uses IndexedDB), then falls back to a `?lang=`
 *     URL hash so a chosen language survives a reload even in private mode.
 *   - Updates <html lang> and <html dir> when the language changes, so
 *     screen readers, search engines, and CSS :lang() selectors all behave.
 *   - Exposes window.i18n.t(key) for app.js so dynamic status messages can
 *     be translated.
 *
 * Adding a language: append to LOCALES with full key coverage. Missing keys
 * fall back to English automatically.
 */

const LOCALES = {
  en: {
    _name: 'English',
    _dir: 'ltr',
    hero_title: 'Offline MAC Address Lookup',
    tagline_prefix: 'Offline lookup across IEEE',
    tagline_suffix: 'registries.',
    and: 'and',
    lookup_heading: 'Lookup',
    input_label: 'MAC address, prefix, or vendor name',
    input_placeholder: '00:1A:7D…  or  cisco',
    input_hint: 'Hex input does a longest-prefix lookup (MA-S → MA-M → MA-L). Text input does fuzzy vendor search.',
    noscript: 'This app requires JavaScript to do the offline lookup.',
    status_loading: 'Loading registry…',
    refresh_button: 'Refresh data',
    refresh_title: 'Fetch the latest IEEE registries (online only)',
    refresh_aria: 'Refresh registry data',
    data_version_label: 'Data version:',
    source_link: 'source',
    language_label: 'Language',
    no_matches: 'No matches.',
    registry_loading: 'Registry still loading…',
    no_prefix: 'No registry entry for prefix {0}.',
    loaded_from_cache: 'Loaded {0} entries from cache.',
    loaded_latest: 'Loaded {0} entries (latest).',
    up_to_date: '{0} entries · up to date',
    using_cached: '{0} entries · using cached data',
    could_not_load: 'Could not load registry data{0}.',
    could_not_load_reload: 'Could not load registry data{0}. Connect to the network and reload.',
    offline_no_cache: 'Offline and no cached data.',
    offline_no_cache_reload: 'Offline and no cached data. Connect to the network and reload.',
    offline_cannot_refresh: 'Offline — cannot refresh.',
    checking_updates: 'Checking for updates…',
    downloading: 'Downloading registry…',
    refreshed: 'Refreshed — {0} entries.',
    already_up_to_date: 'Already up to date — {0} entries.',
    refresh_cancelled: 'Refresh cancelled.',
    refresh_failed_keeping: 'Refresh failed — keeping cached data.',
    refresh_failed: 'Refresh failed: {0}',
    entries_online: '{0} entries · online',
    entries_offline: '{0} entries · offline',
    updated_latest: 'Updated to latest — {0} entries.',
    in_memory_only: 'in-memory only',
    failed_startup: 'Failed to start up.',
    failed_load_refresh: 'Failed to load. Try refreshing the page.',
  },
  es: {
    _name: 'Español',
    _dir: 'ltr',
    hero_title: 'Búsqueda offline de direcciones MAC',
    tagline_prefix: 'Búsqueda sin conexión en los registros IEEE',
    tagline_suffix: '.',
    and: 'y',
    lookup_heading: 'Búsqueda',
    input_label: 'Dirección MAC, prefijo o nombre del fabricante',
    input_placeholder: '00:1A:7D…  o  cisco',
    input_hint: 'Entrada hex: búsqueda por prefijo más largo (MA-S → MA-M → MA-L). Texto: búsqueda difusa del fabricante.',
    noscript: 'Esta app requiere JavaScript para la búsqueda offline.',
    status_loading: 'Cargando registro…',
    refresh_button: 'Actualizar datos',
    refresh_title: 'Obtener los registros IEEE más recientes (solo online)',
    refresh_aria: 'Actualizar datos del registro',
    data_version_label: 'Versión de los datos:',
    source_link: 'código fuente',
    language_label: 'Idioma',
    no_matches: 'Sin coincidencias.',
    registry_loading: 'Cargando registro…',
    no_prefix: 'Sin entrada para el prefijo {0}.',
    loaded_from_cache: '{0} entradas cargadas desde la caché.',
    loaded_latest: '{0} entradas cargadas (más recientes).',
    up_to_date: '{0} entradas · actualizado',
    using_cached: '{0} entradas · usando caché',
    could_not_load: 'No se pudieron cargar los datos{0}.',
    could_not_load_reload: 'No se pudieron cargar los datos{0}. Conéctate a la red y recarga.',
    offline_no_cache: 'Sin conexión y sin datos en caché.',
    offline_no_cache_reload: 'Sin conexión y sin datos en caché. Conéctate y recarga.',
    offline_cannot_refresh: 'Sin conexión — no se puede actualizar.',
    checking_updates: 'Buscando actualizaciones…',
    downloading: 'Descargando registro…',
    refreshed: 'Actualizado — {0} entradas.',
    already_up_to_date: 'Ya está actualizado — {0} entradas.',
    refresh_cancelled: 'Actualización cancelada.',
    refresh_failed_keeping: 'Actualización fallida — manteniendo datos en caché.',
    refresh_failed: 'Actualización fallida: {0}',
    entries_online: '{0} entradas · en línea',
    entries_offline: '{0} entradas · sin conexión',
    updated_latest: 'Actualizado a la última — {0} entradas.',
    in_memory_only: 'solo en memoria',
    failed_startup: 'Error al iniciar.',
    failed_load_refresh: 'Error al cargar. Intenta recargar la página.',
  },
  fr: {
    _name: 'Français',
    _dir: 'ltr',
    hero_title: 'Recherche MAC hors ligne',
    tagline_prefix: 'Recherche hors ligne dans les registres IEEE',
    tagline_suffix: '.',
    and: 'et',
    lookup_heading: 'Recherche',
    input_label: 'Adresse MAC, préfixe ou nom du fabricant',
    input_placeholder: '00:1A:7D…  ou  cisco',
    input_hint: 'Entrée hex : préfixe le plus long (MA-S → MA-M → MA-L). Texte : recherche floue du fabricant.',
    noscript: 'Cette application nécessite JavaScript pour la recherche hors ligne.',
    status_loading: 'Chargement du registre…',
    refresh_button: 'Actualiser',
    refresh_title: 'Récupérer les derniers registres IEEE (en ligne uniquement)',
    refresh_aria: 'Actualiser les données du registre',
    data_version_label: 'Version des données :',
    source_link: 'source',
    language_label: 'Langue',
    no_matches: 'Aucune correspondance.',
    registry_loading: 'Chargement du registre…',
    no_prefix: 'Aucune entrée pour le préfixe {0}.',
    loaded_from_cache: '{0} entrées chargées depuis le cache.',
    loaded_latest: '{0} entrées chargées (à jour).',
    up_to_date: '{0} entrées · à jour',
    using_cached: '{0} entrées · cache utilisé',
    could_not_load: 'Impossible de charger les données{0}.',
    could_not_load_reload: 'Impossible de charger les données{0}. Connectez-vous au réseau et rechargez.',
    offline_no_cache: 'Hors ligne et sans cache.',
    offline_no_cache_reload: 'Hors ligne et sans cache. Connectez-vous et rechargez.',
    offline_cannot_refresh: 'Hors ligne — actualisation impossible.',
    checking_updates: 'Vérification des mises à jour…',
    downloading: 'Téléchargement du registre…',
    refreshed: 'Actualisé — {0} entrées.',
    already_up_to_date: 'Déjà à jour — {0} entrées.',
    refresh_cancelled: 'Actualisation annulée.',
    refresh_failed_keeping: 'Échec de l\'actualisation — conservation du cache.',
    refresh_failed: 'Échec de l\'actualisation : {0}',
    entries_online: '{0} entrées · en ligne',
    entries_offline: '{0} entrées · hors ligne',
    updated_latest: 'Mise à jour vers la dernière version — {0} entrées.',
    in_memory_only: 'mémoire uniquement',
    failed_startup: 'Échec du démarrage.',
    failed_load_refresh: 'Échec du chargement. Essayez de recharger la page.',
  },
  de: {
    _name: 'Deutsch',
    _dir: 'ltr',
    hero_title: 'Offline-MAC-Adresssuche',
    tagline_prefix: 'Offline-Suche in den IEEE-Registern',
    tagline_suffix: '.',
    and: 'und',
    lookup_heading: 'Suche',
    input_label: 'MAC-Adresse, Präfix oder Herstellername',
    input_placeholder: '00:1A:7D…  oder  cisco',
    input_hint: 'Hex-Eingabe: längste Präfix-Suche (MA-S → MA-M → MA-L). Text: Fuzzy-Herstellersuche.',
    noscript: 'Diese App benötigt JavaScript für die Offline-Suche.',
    status_loading: 'Register wird geladen…',
    refresh_button: 'Daten aktualisieren',
    refresh_title: 'Neueste IEEE-Register abrufen (nur online)',
    refresh_aria: 'Registerdaten aktualisieren',
    data_version_label: 'Datenversion:',
    source_link: 'Quellcode',
    language_label: 'Sprache',
    no_matches: 'Keine Treffer.',
    registry_loading: 'Register wird geladen…',
    no_prefix: 'Kein Eintrag für Präfix {0}.',
    loaded_from_cache: '{0} Einträge aus dem Cache geladen.',
    loaded_latest: '{0} Einträge geladen (aktuell).',
    up_to_date: '{0} Einträge · aktuell',
    using_cached: '{0} Einträge · Cache wird verwendet',
    could_not_load: 'Daten konnten nicht geladen werden{0}.',
    could_not_load_reload: 'Daten konnten nicht geladen werden{0}. Bitte verbinden und neu laden.',
    offline_no_cache: 'Offline und keine Cache-Daten.',
    offline_no_cache_reload: 'Offline und keine Cache-Daten. Bitte verbinden und neu laden.',
    offline_cannot_refresh: 'Offline — Aktualisierung nicht möglich.',
    checking_updates: 'Suche nach Updates…',
    downloading: 'Register wird heruntergeladen…',
    refreshed: 'Aktualisiert — {0} Einträge.',
    already_up_to_date: 'Bereits aktuell — {0} Einträge.',
    refresh_cancelled: 'Aktualisierung abgebrochen.',
    refresh_failed_keeping: 'Aktualisierung fehlgeschlagen — Cache wird beibehalten.',
    refresh_failed: 'Aktualisierung fehlgeschlagen: {0}',
    entries_online: '{0} Einträge · online',
    entries_offline: '{0} Einträge · offline',
    updated_latest: 'Auf neueste Version aktualisiert — {0} Einträge.',
    in_memory_only: 'nur im Speicher',
    failed_startup: 'Start fehlgeschlagen.',
    failed_load_refresh: 'Laden fehlgeschlagen. Bitte Seite neu laden.',
  },
  it: {
    _name: 'Italiano',
    _dir: 'ltr',
    hero_title: 'Ricerca MAC offline',
    tagline_prefix: 'Ricerca offline nei registri IEEE',
    tagline_suffix: '.',
    and: 'e',
    lookup_heading: 'Ricerca',
    input_label: 'Indirizzo MAC, prefisso o nome del produttore',
    input_placeholder: '00:1A:7D…  o  cisco',
    input_hint: 'Hex: ricerca per prefisso più lungo (MA-S → MA-M → MA-L). Testo: ricerca fuzzy del produttore.',
    noscript: 'Questa app richiede JavaScript per la ricerca offline.',
    status_loading: 'Caricamento del registro…',
    refresh_button: 'Aggiorna dati',
    refresh_title: 'Scarica gli ultimi registri IEEE (solo online)',
    refresh_aria: 'Aggiorna i dati del registro',
    data_version_label: 'Versione dati:',
    source_link: 'codice',
    language_label: 'Lingua',
    no_matches: 'Nessun risultato.',
    registry_loading: 'Caricamento del registro…',
    no_prefix: 'Nessuna voce per il prefisso {0}.',
    loaded_from_cache: '{0} voci caricate dalla cache.',
    loaded_latest: '{0} voci caricate (aggiornate).',
    up_to_date: '{0} voci · aggiornato',
    using_cached: '{0} voci · uso cache',
    could_not_load: 'Impossibile caricare i dati{0}.',
    could_not_load_reload: 'Impossibile caricare i dati{0}. Connettiti e ricarica.',
    offline_no_cache: 'Offline e senza cache.',
    offline_no_cache_reload: 'Offline e senza cache. Connettiti e ricarica.',
    offline_cannot_refresh: 'Offline — aggiornamento non possibile.',
    checking_updates: 'Ricerca aggiornamenti…',
    downloading: 'Download del registro…',
    refreshed: 'Aggiornato — {0} voci.',
    already_up_to_date: 'Già aggiornato — {0} voci.',
    refresh_cancelled: 'Aggiornamento annullato.',
    refresh_failed_keeping: 'Aggiornamento fallito — mantengo la cache.',
    refresh_failed: 'Aggiornamento fallito: {0}',
    entries_online: '{0} voci · online',
    entries_offline: '{0} voci · offline',
    updated_latest: 'Aggiornato all\'ultima versione — {0} voci.',
    in_memory_only: 'solo in memoria',
    failed_startup: 'Avvio non riuscito.',
    failed_load_refresh: 'Caricamento fallito. Ricarica la pagina.',
  },
  pt: {
    _name: 'Português',
    _dir: 'ltr',
    hero_title: 'Pesquisa MAC offline',
    tagline_prefix: 'Pesquisa offline nos registos IEEE',
    tagline_suffix: '.',
    and: 'e',
    lookup_heading: 'Pesquisa',
    input_label: 'Endereço MAC, prefixo ou nome do fabricante',
    input_placeholder: '00:1A:7D…  ou  cisco',
    input_hint: 'Hex: pesquisa por prefixo mais longo (MA-S → MA-M → MA-L). Texto: pesquisa difusa do fabricante.',
    noscript: 'Esta app precisa de JavaScript para a pesquisa offline.',
    status_loading: 'A carregar registo…',
    refresh_button: 'Atualizar dados',
    refresh_title: 'Obter os registos IEEE mais recentes (apenas online)',
    refresh_aria: 'Atualizar dados do registo',
    data_version_label: 'Versão dos dados:',
    source_link: 'código',
    language_label: 'Idioma',
    no_matches: 'Sem resultados.',
    registry_loading: 'A carregar registo…',
    no_prefix: 'Sem entrada para o prefixo {0}.',
    loaded_from_cache: '{0} entradas carregadas da cache.',
    loaded_latest: '{0} entradas carregadas (atualizadas).',
    up_to_date: '{0} entradas · atualizado',
    using_cached: '{0} entradas · usando cache',
    could_not_load: 'Não foi possível carregar os dados{0}.',
    could_not_load_reload: 'Não foi possível carregar os dados{0}. Conecte-se à rede e recarregue.',
    offline_no_cache: 'Offline e sem cache.',
    offline_no_cache_reload: 'Offline e sem cache. Conecte-se e recarregue.',
    offline_cannot_refresh: 'Offline — não é possível atualizar.',
    checking_updates: 'A verificar atualizações…',
    downloading: 'A descarregar registo…',
    refreshed: 'Atualizado — {0} entradas.',
    already_up_to_date: 'Já está atualizado — {0} entradas.',
    refresh_cancelled: 'Atualização cancelada.',
    refresh_failed_keeping: 'Atualização falhou — a manter a cache.',
    refresh_failed: 'Atualização falhou: {0}',
    entries_online: '{0} entradas · online',
    entries_offline: '{0} entradas · offline',
    updated_latest: 'Atualizado para a versão mais recente — {0} entradas.',
    in_memory_only: 'apenas em memória',
    failed_startup: 'Falha ao iniciar.',
    failed_load_refresh: 'Falha ao carregar. Tente recarregar a página.',
  },
  'zh-Hans': {
    _name: '简体中文',
    _dir: 'ltr',
    hero_title: '离线 MAC 地址查询',
    tagline_prefix: '在 IEEE',
    tagline_suffix: '注册表中离线查询。',
    and: '和',
    lookup_heading: '查询',
    input_label: 'MAC 地址、前缀或厂商名称',
    input_placeholder: '00:1A:7D…  或  cisco',
    input_hint: '十六进制输入按最长前缀匹配 (MA-S → MA-M → MA-L)。文本输入为模糊厂商搜索。',
    noscript: '此应用需要 JavaScript 才能进行离线查询。',
    status_loading: '正在加载注册表…',
    refresh_button: '刷新数据',
    refresh_title: '获取最新的 IEEE 注册表(需联网)',
    refresh_aria: '刷新注册表数据',
    data_version_label: '数据版本:',
    source_link: '源代码',
    language_label: '语言',
    no_matches: '无匹配结果。',
    registry_loading: '注册表仍在加载…',
    no_prefix: '前缀 {0} 无对应记录。',
    loaded_from_cache: '已从缓存加载 {0} 条记录。',
    loaded_latest: '已加载 {0} 条记录(最新)。',
    up_to_date: '{0} 条记录 · 已是最新',
    using_cached: '{0} 条记录 · 使用缓存',
    could_not_load: '无法加载注册表数据{0}。',
    could_not_load_reload: '无法加载注册表数据{0}。请连接网络后重新加载。',
    offline_no_cache: '离线且无缓存数据。',
    offline_no_cache_reload: '离线且无缓存数据。请连接网络后重新加载。',
    offline_cannot_refresh: '离线 — 无法刷新。',
    checking_updates: '正在检查更新…',
    downloading: '正在下载注册表…',
    refreshed: '已刷新 — {0} 条记录。',
    already_up_to_date: '已是最新 — {0} 条记录。',
    refresh_cancelled: '刷新已取消。',
    refresh_failed_keeping: '刷新失败 — 保留缓存数据。',
    refresh_failed: '刷新失败: {0}',
    entries_online: '{0} 条记录 · 在线',
    entries_offline: '{0} 条记录 · 离线',
    updated_latest: '已更新到最新 — {0} 条记录。',
    in_memory_only: '仅内存',
    failed_startup: '启动失败。',
    failed_load_refresh: '加载失败。请尝试刷新页面。',
  },
  'zh-Hant': {
    _name: '繁體中文 / 廣東話',
    _dir: 'ltr',
    hero_title: '離線 MAC 位址查詢',
    tagline_prefix: '在 IEEE',
    tagline_suffix: '註冊表中離線查詢。',
    and: '和',
    lookup_heading: '查詢',
    input_label: 'MAC 位址、前綴或廠商名稱',
    input_placeholder: '00:1A:7D…  或  cisco',
    input_hint: '十六進位輸入按最長前綴比對 (MA-S → MA-M → MA-L)。文字輸入為模糊廠商搜尋。',
    noscript: '此應用程式需要 JavaScript 才能進行離線查詢。',
    status_loading: '正在載入註冊表…',
    refresh_button: '重新整理資料',
    refresh_title: '取得最新的 IEEE 註冊表(需連線)',
    refresh_aria: '重新整理註冊表資料',
    data_version_label: '資料版本:',
    source_link: '原始碼',
    language_label: '語言',
    no_matches: '沒有相符結果。',
    registry_loading: '註冊表仍在載入…',
    no_prefix: '前綴 {0} 沒有對應紀錄。',
    loaded_from_cache: '已從快取載入 {0} 筆紀錄。',
    loaded_latest: '已載入 {0} 筆紀錄(最新)。',
    up_to_date: '{0} 筆紀錄 · 已是最新',
    using_cached: '{0} 筆紀錄 · 使用快取',
    could_not_load: '無法載入註冊表資料{0}。',
    could_not_load_reload: '無法載入註冊表資料{0}。請連線後重新載入。',
    offline_no_cache: '離線且無快取資料。',
    offline_no_cache_reload: '離線且無快取資料。請連線後重新載入。',
    offline_cannot_refresh: '離線 — 無法重新整理。',
    checking_updates: '正在檢查更新…',
    downloading: '正在下載註冊表…',
    refreshed: '已更新 — {0} 筆紀錄。',
    already_up_to_date: '已是最新 — {0} 筆紀錄。',
    refresh_cancelled: '重新整理已取消。',
    refresh_failed_keeping: '重新整理失敗 — 保留快取資料。',
    refresh_failed: '重新整理失敗: {0}',
    entries_online: '{0} 筆紀錄 · 在線',
    entries_offline: '{0} 筆紀錄 · 離線',
    updated_latest: '已更新到最新 — {0} 筆紀錄。',
    in_memory_only: '僅記憶體',
    failed_startup: '啟動失敗。',
    failed_load_refresh: '載入失敗。請嘗試重新整理頁面。',
  },
  ja: {
    _name: '日本語',
    _dir: 'ltr',
    hero_title: 'オフライン MAC アドレス検索',
    tagline_prefix: 'IEEE',
    tagline_suffix: 'レジストリのオフライン検索。',
    and: 'と',
    lookup_heading: '検索',
    input_label: 'MAC アドレス、プレフィックス、またはベンダー名',
    input_placeholder: '00:1A:7D…  または  cisco',
    input_hint: '16 進入力は最長プレフィックス検索 (MA-S → MA-M → MA-L)。テキストはファジー検索。',
    noscript: 'このアプリはオフライン検索のために JavaScript が必要です。',
    status_loading: 'レジストリを読み込み中…',
    refresh_button: 'データを更新',
    refresh_title: '最新の IEEE レジストリを取得(オンライン時のみ)',
    refresh_aria: 'レジストリデータを更新',
    data_version_label: 'データバージョン:',
    source_link: 'ソース',
    language_label: '言語',
    no_matches: '一致なし。',
    registry_loading: 'レジストリを読み込み中…',
    no_prefix: 'プレフィックス {0} のエントリがありません。',
    loaded_from_cache: 'キャッシュから {0} 件を読み込みました。',
    loaded_latest: '{0} 件を読み込みました(最新)。',
    up_to_date: '{0} 件 · 最新',
    using_cached: '{0} 件 · キャッシュ使用',
    could_not_load: 'データを読み込めませんでした{0}。',
    could_not_load_reload: 'データを読み込めませんでした{0}。ネットワークに接続して再読み込みしてください。',
    offline_no_cache: 'オフラインかつキャッシュなし。',
    offline_no_cache_reload: 'オフラインかつキャッシュなし。接続して再読み込みしてください。',
    offline_cannot_refresh: 'オフライン — 更新できません。',
    checking_updates: '更新を確認中…',
    downloading: 'レジストリをダウンロード中…',
    refreshed: '更新しました — {0} 件。',
    already_up_to_date: '既に最新 — {0} 件。',
    refresh_cancelled: '更新をキャンセルしました。',
    refresh_failed_keeping: '更新失敗 — キャッシュを保持します。',
    refresh_failed: '更新失敗: {0}',
    entries_online: '{0} 件 · オンライン',
    entries_offline: '{0} 件 · オフライン',
    updated_latest: '最新に更新 — {0} 件。',
    in_memory_only: 'メモリのみ',
    failed_startup: '起動に失敗しました。',
    failed_load_refresh: '読み込みに失敗しました。ページを再読み込みしてください。',
  },
  ko: {
    _name: '한국어',
    _dir: 'ltr',
    hero_title: '오프라인 MAC 주소 조회',
    tagline_prefix: 'IEEE',
    tagline_suffix: '레지스트리에서 오프라인 조회.',
    and: '및',
    lookup_heading: '조회',
    input_label: 'MAC 주소, 접두사 또는 제조사 이름',
    input_placeholder: '00:1A:7D…  또는  cisco',
    input_hint: '16진 입력은 최장 접두사 조회 (MA-S → MA-M → MA-L). 텍스트는 퍼지 검색.',
    noscript: '이 앱은 오프라인 조회를 위해 JavaScript가 필요합니다.',
    status_loading: '레지스트리 로딩 중…',
    refresh_button: '데이터 새로고침',
    refresh_title: '최신 IEEE 레지스트리 가져오기 (온라인 전용)',
    refresh_aria: '레지스트리 데이터 새로고침',
    data_version_label: '데이터 버전:',
    source_link: '소스',
    language_label: '언어',
    no_matches: '일치 항목 없음.',
    registry_loading: '레지스트리 로딩 중…',
    no_prefix: '접두사 {0}에 해당하는 항목이 없습니다.',
    loaded_from_cache: '캐시에서 {0}개 항목 로드됨.',
    loaded_latest: '{0}개 항목 로드됨 (최신).',
    up_to_date: '{0}개 항목 · 최신',
    using_cached: '{0}개 항목 · 캐시 사용',
    could_not_load: '데이터를 로드할 수 없습니다{0}.',
    could_not_load_reload: '데이터를 로드할 수 없습니다{0}. 네트워크 연결 후 다시 로드하세요.',
    offline_no_cache: '오프라인이며 캐시 없음.',
    offline_no_cache_reload: '오프라인이며 캐시 없음. 연결 후 다시 로드하세요.',
    offline_cannot_refresh: '오프라인 — 새로고침 불가.',
    checking_updates: '업데이트 확인 중…',
    downloading: '레지스트리 다운로드 중…',
    refreshed: '새로고침됨 — {0}개 항목.',
    already_up_to_date: '이미 최신 — {0}개 항목.',
    refresh_cancelled: '새로고침 취소됨.',
    refresh_failed_keeping: '새로고침 실패 — 캐시 유지.',
    refresh_failed: '새로고침 실패: {0}',
    entries_online: '{0}개 항목 · 온라인',
    entries_offline: '{0}개 항목 · 오프라인',
    updated_latest: '최신으로 업데이트됨 — {0}개 항목.',
    in_memory_only: '메모리 전용',
    failed_startup: '시작 실패.',
    failed_load_refresh: '로드 실패. 페이지를 새로고침하세요.',
  },
  hi: {
    _name: 'हिन्दी',
    _dir: 'ltr',
    hero_title: 'ऑफ़लाइन MAC पता खोज',
    tagline_prefix: 'IEEE',
    tagline_suffix: 'रजिस्ट्री में ऑफ़लाइन खोज।',
    and: 'और',
    lookup_heading: 'खोज',
    input_label: 'MAC पता, उपसर्ग, या निर्माता का नाम',
    input_placeholder: '00:1A:7D…  या  cisco',
    input_hint: 'हेक्स इनपुट: सबसे लंबा उपसर्ग खोज (MA-S → MA-M → MA-L)। टेक्स्ट: फ़ज़ी निर्माता खोज।',
    noscript: 'इस ऐप को ऑफ़लाइन खोज के लिए JavaScript चाहिए।',
    status_loading: 'रजिस्ट्री लोड हो रही है…',
    refresh_button: 'डेटा रिफ़्रेश करें',
    refresh_title: 'नवीनतम IEEE रजिस्ट्री प्राप्त करें (केवल ऑनलाइन)',
    refresh_aria: 'रजिस्ट्री डेटा रिफ़्रेश करें',
    data_version_label: 'डेटा संस्करण:',
    source_link: 'स्रोत',
    language_label: 'भाषा',
    no_matches: 'कोई मिलान नहीं।',
    registry_loading: 'रजिस्ट्री अभी भी लोड हो रही है…',
    no_prefix: 'उपसर्ग {0} के लिए कोई प्रविष्टि नहीं।',
    loaded_from_cache: 'कैश से {0} प्रविष्टियाँ लोड हुईं।',
    loaded_latest: '{0} प्रविष्टियाँ लोड हुईं (नवीनतम)।',
    up_to_date: '{0} प्रविष्टियाँ · अद्यतन',
    using_cached: '{0} प्रविष्टियाँ · कैश का उपयोग',
    could_not_load: 'डेटा लोड नहीं हो सका{0}।',
    could_not_load_reload: 'डेटा लोड नहीं हो सका{0}। नेटवर्क से जुड़ें और पुनः लोड करें।',
    offline_no_cache: 'ऑफ़लाइन और कोई कैश डेटा नहीं।',
    offline_no_cache_reload: 'ऑफ़लाइन और कोई कैश डेटा नहीं। जुड़ें और पुनः लोड करें।',
    offline_cannot_refresh: 'ऑफ़लाइन — रिफ़्रेश संभव नहीं।',
    checking_updates: 'अपडेट जाँचे जा रहे हैं…',
    downloading: 'रजिस्ट्री डाउनलोड हो रही है…',
    refreshed: 'रिफ़्रेश किया गया — {0} प्रविष्टियाँ।',
    already_up_to_date: 'पहले से अद्यतन — {0} प्रविष्टियाँ।',
    refresh_cancelled: 'रिफ़्रेश रद्द किया गया।',
    refresh_failed_keeping: 'रिफ़्रेश विफल — कैश डेटा रखा गया।',
    refresh_failed: 'रिफ़्रेश विफल: {0}',
    entries_online: '{0} प्रविष्टियाँ · ऑनलाइन',
    entries_offline: '{0} प्रविष्टियाँ · ऑफ़लाइन',
    updated_latest: 'नवीनतम पर अपडेट — {0} प्रविष्टियाँ।',
    in_memory_only: 'केवल मेमोरी',
    failed_startup: 'शुरू होने में विफल।',
    failed_load_refresh: 'लोड विफल। पृष्ठ पुनः लोड करें।',
  },
  fil: {
    _name: 'Filipino / Tagalog',
    _dir: 'ltr',
    hero_title: 'Offline na Paghahanap ng MAC Address',
    tagline_prefix: 'Offline na paghahanap sa IEEE',
    tagline_suffix: 'na registry.',
    and: 'at',
    lookup_heading: 'Paghahanap',
    input_label: 'MAC address, prefix, o pangalan ng vendor',
    input_placeholder: '00:1A:7D…  o  cisco',
    input_hint: 'Hex: pinakamahabang prefix (MA-S → MA-M → MA-L). Teksto: fuzzy na paghahanap ng vendor.',
    noscript: 'Kailangan ng JavaScript ng app na ito para sa offline na paghahanap.',
    status_loading: 'Naglo-load ng registry…',
    refresh_button: 'I-refresh ang data',
    refresh_title: 'Kunin ang pinakabagong IEEE registries (online lang)',
    refresh_aria: 'I-refresh ang registry data',
    data_version_label: 'Bersyon ng data:',
    source_link: 'source',
    language_label: 'Wika',
    no_matches: 'Walang tugma.',
    registry_loading: 'Naglo-load pa ang registry…',
    no_prefix: 'Walang entry para sa prefix {0}.',
    loaded_from_cache: 'Naglo-load ng {0} entries mula sa cache.',
    loaded_latest: 'Naglo-load ng {0} entries (pinakabago).',
    up_to_date: '{0} entries · pinakabago',
    using_cached: '{0} entries · gumagamit ng cache',
    could_not_load: 'Hindi ma-load ang data{0}.',
    could_not_load_reload: 'Hindi ma-load ang data{0}. Kumonekta sa network at i-reload.',
    offline_no_cache: 'Offline at walang cache.',
    offline_no_cache_reload: 'Offline at walang cache. Kumonekta at i-reload.',
    offline_cannot_refresh: 'Offline — hindi maaaring mag-refresh.',
    checking_updates: 'Tinitingnan ang mga update…',
    downloading: 'Nagda-download ng registry…',
    refreshed: 'Na-refresh — {0} entries.',
    already_up_to_date: 'Pinakabago na — {0} entries.',
    refresh_cancelled: 'Kanselado ang refresh.',
    refresh_failed_keeping: 'Bigo ang refresh — pinanatili ang cache.',
    refresh_failed: 'Bigo ang refresh: {0}',
    entries_online: '{0} entries · online',
    entries_offline: '{0} entries · offline',
    updated_latest: 'Na-update sa pinakabago — {0} entries.',
    in_memory_only: 'memory lang',
    failed_startup: 'Bigo ang pagsisimula.',
    failed_load_refresh: 'Bigo ang pag-load. Subukang i-reload ang pahina.',
  },
  ar: {
    _name: 'العربية',
    _dir: 'rtl',
    hero_title: 'بحث عن عناوين MAC دون اتصال',
    tagline_prefix: 'بحث دون اتصال في سجلات',
    tagline_suffix: 'الخاصة بـ IEEE.',
    and: 'و',
    lookup_heading: 'بحث',
    input_label: 'عنوان MAC أو بادئة أو اسم المُصنِّع',
    input_placeholder: '00:1A:7D…  أو  cisco',
    input_hint: 'الإدخال السداسي يجري بحثًا بأطول بادئة (MA-S → MA-M → MA-L). النص يجري بحثًا ضبابيًا.',
    noscript: 'يحتاج هذا التطبيق إلى JavaScript للعمل دون اتصال.',
    status_loading: 'جاري تحميل السجل…',
    refresh_button: 'تحديث البيانات',
    refresh_title: 'جلب أحدث سجلات IEEE (يتطلب اتصالًا)',
    refresh_aria: 'تحديث بيانات السجل',
    data_version_label: 'إصدار البيانات:',
    source_link: 'المصدر',
    language_label: 'اللغة',
    no_matches: 'لا توجد نتائج.',
    registry_loading: 'لا يزال السجل قيد التحميل…',
    no_prefix: 'لا يوجد سجل للبادئة {0}.',
    loaded_from_cache: 'تم تحميل {0} إدخالاً من الذاكرة المؤقتة.',
    loaded_latest: 'تم تحميل {0} إدخالاً (الأحدث).',
    up_to_date: '{0} إدخال · محدّث',
    using_cached: '{0} إدخال · استخدام الذاكرة المؤقتة',
    could_not_load: 'تعذّر تحميل البيانات{0}.',
    could_not_load_reload: 'تعذّر تحميل البيانات{0}. اتصل بالشبكة وأعد التحميل.',
    offline_no_cache: 'دون اتصال ولا توجد بيانات مؤقتة.',
    offline_no_cache_reload: 'دون اتصال ولا توجد بيانات مؤقتة. اتصل وأعد التحميل.',
    offline_cannot_refresh: 'دون اتصال — لا يمكن التحديث.',
    checking_updates: 'البحث عن تحديثات…',
    downloading: 'جاري تنزيل السجل…',
    refreshed: 'تم التحديث — {0} إدخال.',
    already_up_to_date: 'محدّث بالفعل — {0} إدخال.',
    refresh_cancelled: 'تم إلغاء التحديث.',
    refresh_failed_keeping: 'فشل التحديث — الاحتفاظ بالذاكرة المؤقتة.',
    refresh_failed: 'فشل التحديث: {0}',
    entries_online: '{0} إدخال · متصل',
    entries_offline: '{0} إدخال · دون اتصال',
    updated_latest: 'تم التحديث إلى الأحدث — {0} إدخال.',
    in_memory_only: 'الذاكرة فقط',
    failed_startup: 'فشل البدء.',
    failed_load_refresh: 'فشل التحميل. حاول إعادة تحميل الصفحة.',
  },
};

const SUPPORTED = Object.keys(LOCALES);
const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'maclookup.lang';

// Map browser language tags to our supported keys.
//   - "zh-CN", "zh-SG", "zh-Hans-*" -> zh-Hans
//   - "zh-HK", "zh-TW", "zh-Hant-*", "yue-*" (Cantonese) -> zh-Hant
//   - "fil-*", "tl-*" -> fil
//   - "pt-*" -> pt, "es-*" -> es, etc.
function normalizeLocale(tag) {
  if (!tag) return null;
  const t = String(tag).trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  // Chinese: script tag wins, then region.
  if (lower.startsWith('zh')) {
    if (/(^|[-_])(hant|tw|hk|mo)([-_]|$)/.test(lower)) return 'zh-Hant';
    if (/(^|[-_])(hans|cn|sg|my)([-_]|$)/.test(lower)) return 'zh-Hans';
    return 'zh-Hans';
  }
  // Cantonese
  if (lower.startsWith('yue')) return 'zh-Hant';
  // Tagalog / Filipino
  if (lower.startsWith('fil') || lower.startsWith('tl')) return 'fil';

  // Strip region for the rest: "fr-CA" -> "fr".
  const base = lower.split(/[-_]/)[0];
  if (SUPPORTED.indexOf(base) >= 0) return base;
  return null;
}

function readPersisted() {
  // 1) URL ?lang= or #lang= override (highest priority, lets users share a
  //    pre-translated link)
  try {
    const u = new URL(location.href);
    const q = u.searchParams.get('lang');
    if (q) {
      const n = normalizeLocale(q) || (SUPPORTED.indexOf(q) >= 0 ? q : null);
      if (n) return n;
    }
    const h = (location.hash || '').replace(/^#/, '');
    if (h) {
      const params = new URLSearchParams(h);
      const v = params.get('lang');
      if (v) {
        const n = normalizeLocale(v) || (SUPPORTED.indexOf(v) >= 0 ? v : null);
        if (n) return n;
      }
    }
  } catch (_) { /* ignore */ }

  // 2) localStorage (best-effort — private mode can throw on read)
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && SUPPORTED.indexOf(v) >= 0) return v;
    }
  } catch (_) { /* ignore */ }

  return null;
}

function detectFromNavigator() {
  try {
    const list = (navigator && navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator && navigator.language].filter(Boolean);
    for (const tag of list) {
      const n = normalizeLocale(tag);
      if (n) return n;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function pickInitial() {
  return readPersisted() || detectFromNavigator() || DEFAULT_LOCALE;
}

function persist(locale) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, locale);
      return;
    }
  } catch (_) { /* ignore — fall through to URL */ }
  // Fallback: encode in URL hash so a reload keeps the choice.
  try {
    const u = new URL(location.href);
    const h = new URLSearchParams((u.hash || '').replace(/^#/, ''));
    h.set('lang', locale);
    u.hash = h.toString();
    history.replaceState(null, '', u.toString());
  } catch (_) { /* ignore */ }
}

let currentLocale = DEFAULT_LOCALE;

function t(key, ...args) {
  const dict = LOCALES[currentLocale] || LOCALES[DEFAULT_LOCALE];
  let s = dict[key];
  if (s == null) s = LOCALES[DEFAULT_LOCALE][key];
  if (s == null) return key;
  for (let i = 0; i < args.length; i++) {
    s = s.split('{' + i + '}').join(String(args[i]));
  }
  return s;
}

function applyTranslations() {
  const root = document;
  // Text content
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  // Placeholder
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  // Title attribute
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
  // aria-label
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) el.setAttribute('aria-label', t(key));
  });

  // <html lang> + dir
  try {
    document.documentElement.lang = currentLocale;
    document.documentElement.dir = (LOCALES[currentLocale] && LOCALES[currentLocale]._dir) || 'ltr';
  } catch (_) {}

  // Tell app.js to re-render anything that depends on translations.
  try {
    window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale: currentLocale } }));
  } catch (_) {}
}

function buildSelector() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (const code of SUPPORTED) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = LOCALES[code]._name;
    if (code === currentLocale) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    setLocale(sel.value);
  });
}

function setLocale(locale) {
  if (SUPPORTED.indexOf(locale) < 0) locale = DEFAULT_LOCALE;
  currentLocale = locale;
  persist(locale);
  applyTranslations();
}

// Public API on window so app.js (and tests) can use t() for status messages.
window.i18n = {
  t,
  setLocale,
  getLocale: () => currentLocale,
  supported: () => SUPPORTED.slice(),
  normalizeLocale,
  _LOCALES: LOCALES, // exposed for tests; not load-bearing
};

function init() {
  currentLocale = pickInitial();
  buildSelector();
  applyTranslations();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
