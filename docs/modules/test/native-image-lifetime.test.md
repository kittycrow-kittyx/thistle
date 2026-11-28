# Image lifetime regressions

Eighty reloads use the same physical-page budget. Tests check zeroed reused
storage, retention of peer memory and supplementary groups, and no mutation
on allocator-lock contention or invalid frame metadata. Host-file mappings block reload until unmapped.
