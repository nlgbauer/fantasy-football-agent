# Architecture and trust boundaries

ChatPDT treats language-model output, incoming messages, retrieved files, and provider responses as untrusted inputs. Models receive context for drafting but do not receive approval, publication, memory-write, or transaction tools.

## Canonical memory

Reviewed Markdown is the historical source of truth. Conversations and pending or rejected suggestions are stored separately. A proposed change records the complete before and after content, submitter, source, timestamp, and base hash. Approval rechecks both the review digest and current file hash before an atomic replacement.

## Publications

A publication moves from draft to approved to published. Approval binds its text, HTML, PDF hash, source snapshot, destinations, and delivery mode. Any edit clears approval. Each provider delivery has a durable state so a partially successful attempt is not blindly replayed.

## ESPN writes

The optimizer may emit starter/bench moves only. The executor verifies ownership, lock state, roster freshness, projected-gain threshold, legal slots, and the absence of IR movement. It constructs `ROSTER` requests containing only `LINEUP` items and confirms the resulting slot assignments with a fresh read.

Acquisitions, waiver claims, bids, drops, and trade offers have no write implementation. Their analysis remains advisory.

## Provider adapters

Email and WhatsApp implement channel interfaces owned by the core. The core selects destinations, enforces approval, and owns idempotency. Providers return receipts but cannot expand the approved audience or modify canonical memory.



