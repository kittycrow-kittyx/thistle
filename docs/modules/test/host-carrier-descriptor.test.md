# host-carrier-descriptor.test

Verifies descriptor-backed carrier reads, append, quota failure, unlink retention and rejection of lazy completion after slot reuse.

The mapped carrier fixture checks write-back after unlink and pathname reuse, EOF clipping and rejection after final unmap.
