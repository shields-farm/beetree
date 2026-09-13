-- Box-level majority-content classification.
--
-- BoxContent ('brood' | 'honey' | 'empty' | 'mixed' | 'pollen') is the
-- deliberate simplification of per-frame editing: one tap classifies the whole
-- box. The frontend has had setBoxContent since that change, but the value was
-- never persisted — the boxes table had no column for it and the hive PUT only
-- rebuilt type/index/sensorIds/frames. So every box classification reverted on
-- the next syncFromServer().
ALTER TABLE boxes ADD COLUMN content TEXT;
