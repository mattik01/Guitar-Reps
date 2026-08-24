import { PageHeader } from '../components/PageHeader';
import { SubTabs, useTabParam, type SubTab } from '../components/SubTabs';
import BrowsePanel from './BrowsePanel';
import SongsPanel from './SongsPanel';

type Tab = 'mine' | 'browse';
const TABS: SubTab<Tab>[] = [
  { id: 'mine', label: 'My songs' },
  { id: 'browse', label: 'Browse catalog' },
];

export default function Songs() {
  const [tab, setTab] = useTabParam(TABS);

  return (
    <div>
      <PageHeader title="Songs">
        <SubTabs tabs={TABS} active={tab} onChange={setTab} />
      </PageHeader>

      {/*
        BrowsePanel is mounted ONLY on its own tab, never hidden with CSS:
        useCatalog() kicks off a ~200 MB catalog download the moment it mounts.
        Landing on /songs must stay free. Same reason SongsPanel gates its
        <SongCatalogResync/> behind songs.length > 0.
      */}
      {tab === 'mine' ? <SongsPanel /> : <BrowsePanel />}
    </div>
  );
}
