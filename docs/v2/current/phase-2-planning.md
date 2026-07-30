# Phase 2 Implementation Planning

Status: **next V2.0 phase — Plan and Managed Runs**

This document plans execution of Phase 2 in the durable
[V2 delivery plan](delivery-plan.md). It is not an alternative backlog and it
does not replace the delivery plan during cleanup.

## Objective

Deliver the Phase 2 operator outcome: an approved multi-sequence observing
plan becomes an immutable `RunDefinition` that a service-owned bounded sequence
state machine can execute and recover. The browser presents evidence and
intent; it never owns execution.

## Execution Method

1. Select the smallest Phase 2 outcome that advances the end-to-end path.
2. Define its canonical durable owner, accepted scenario, consequential action,
   typed failures, and proof boundary before implementation.
3. Implement and verify that vertical slice, including the required UI/design
   validation when it affects a user surface.
4. Check off the completed delivery-plan outcome and record evidence in the
   relevant current handoff. Then select the next Phase 2 slice.

## Scope Control

- Preserve Phase 1's verified boundaries until an explicit Phase 2 slice
  changes them. Rig-worker liveness is not capture proof; M13 publication is
  not a general processing workflow.
- Do not add physical Solar execution, general processing, storage-health
  operations, or stronger client/session presence merely because they were
  previously deferred. They belong to their named later phase or to
  [post-V2.0 notes](v2-post-v2.0-notes.md) unless the delivery plan changes.
- Minimal implementation does not weaken evidence: the selected proof boundary
  must match the claim.

## First Planning Packet

Before the first code slice, create an accepted packet for the selected Phase 2
outcome with the scenario, durable owner, action/failure contract, focused
verification, proof boundary, and intentionally deferred remainder.
