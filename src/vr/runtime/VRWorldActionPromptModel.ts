import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';

export interface VRWorldPromptCandidate {
  readonly id: string;
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly actorDistanceMetres: number;
  readonly hasActions: boolean;
  readonly inRange: boolean;
}

export interface VRWorldPromptAction {
  readonly kind: 'action';
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  activate(): void;
}

export interface VRWorldPromptNavigationAction {
  readonly kind: 'previous-page' | 'next-page';
  readonly id: 'prompt:previous' | 'prompt:next';
  readonly label: 'Previous' | 'Next';
}

export type VRWorldPromptEntry = VRWorldPromptAction | VRWorldPromptNavigationAction;

export interface VRWorldPromptPage {
  readonly index: number;
  readonly entries: readonly VRWorldPromptEntry[];
}

/** Immutable snapshot consumed by the prompt controller and renderer. */
export interface VRWorldActionPromptModel {
  readonly id: string;
  readonly name: string;
  readonly anchor: THREE.Vector3;
  readonly pages: readonly VRWorldPromptPage[];
}

interface EligibleCandidate {
  readonly candidate: VRWorldPromptCandidate;
  readonly horizontalAngleRadians: number;
}

const MAXIMUM_HORIZONTAL_ANGLE_RADIANS = THREE.MathUtils.degToRad(55);
const ACTIONS_PER_PAGE = 4;
const MINIMUM_DIRECTION_LENGTH_SQUARED = 1e-10;

export function selectVRWorldPromptCandidate(
  candidates: readonly VRWorldPromptCandidate[],
  headPose: XRWorldPose,
  currentCandidateId: string | null,
  aimedIds: readonly string[],
  isInFrustum: (position: THREE.Vector3) => boolean,
): VRWorldPromptCandidate | null {
  if (!Array.isArray(candidates)) {
    throw new TypeError('world prompt candidates must be an array');
  }
  validateHeadPose(headPose);
  if (currentCandidateId !== null && !isNonEmptyString(currentCandidateId)) {
    throw new TypeError('currentCandidateId must be null or a non-empty string');
  }
  if (!Array.isArray(aimedIds)) {
    throw new TypeError('aimedIds must be an array');
  }
  if (typeof isInFrustum !== 'function') {
    throw new TypeError('isInFrustum must be a function');
  }

  const horizontalForward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(headPose.orientation.clone().normalize());
  horizontalForward.z = 0;
  if (horizontalForward.lengthSq() <= MINIMUM_DIRECTION_LENGTH_SQUARED) return null;
  horizontalForward.normalize();

  const eligible = candidates
    .map((candidate) => resolveEligibleCandidate(
      candidate,
      headPose.position,
      horizontalForward,
      isInFrustum,
    ))
    .filter((candidate): candidate is EligibleCandidate => candidate !== null);
  if (eligible.length === 0) return null;

  const eligibleById = new Map<string, EligibleCandidate>();
  for (const entry of eligible) {
    if (!eligibleById.has(entry.candidate.id)) eligibleById.set(entry.candidate.id, entry);
  }

  for (const aimedId of aimedIds) {
    if (!isNonEmptyString(aimedId) || aimedId === currentCandidateId) continue;
    const aimed = eligibleById.get(aimedId);
    if (aimed) return aimed.candidate;
  }

  if (currentCandidateId !== null && aimedIds.includes(currentCandidateId)) {
    const aimedCurrent = eligibleById.get(currentCandidateId);
    if (aimedCurrent) return aimedCurrent.candidate;
  }

  if (currentCandidateId !== null) {
    const current = eligibleById.get(currentCandidateId);
    if (current) return current.candidate;
  }

  eligible.sort((left, right) =>
    left.horizontalAngleRadians - right.horizontalAngleRadians ||
    left.candidate.actorDistanceMetres - right.candidate.actorDistanceMetres ||
    left.candidate.id.localeCompare(right.candidate.id));
  return eligible[0].candidate;
}

export function buildVRWorldPromptPages(
  actions: readonly VRWorldPromptAction[],
): readonly VRWorldPromptPage[] {
  if (!Array.isArray(actions)) {
    throw new TypeError('world prompt actions must be an array');
  }

  const validActions: VRWorldPromptAction[] = [];
  const actionIds = new Set<string>();
  for (const action of actions) {
    if (!isValidAction(action) || actionIds.has(action.id)) continue;
    actionIds.add(action.id);
    validActions.push(action);
  }

  const pages: VRWorldPromptPage[] = [];
  for (let offset = 0; offset < validActions.length; offset += ACTIONS_PER_PAGE) {
    const index = pages.length;
    const entries: VRWorldPromptEntry[] = [];
    if (index > 0) {
      entries.push({
        kind: 'previous-page',
        id: 'prompt:previous',
        label: 'Previous',
      });
    }
    entries.push(...validActions.slice(offset, offset + ACTIONS_PER_PAGE));
    if (offset + ACTIONS_PER_PAGE < validActions.length) {
      entries.push({ kind: 'next-page', id: 'prompt:next', label: 'Next' });
    }
    pages.push({ index, entries });
  }
  return pages;
}

function resolveEligibleCandidate(
  candidate: VRWorldPromptCandidate,
  headPosition: THREE.Vector3,
  horizontalForward: THREE.Vector3,
  isInFrustum: (position: THREE.Vector3) => boolean,
): EligibleCandidate | null {
  if (!isValidCandidate(candidate) || !candidate.inRange || !candidate.hasActions) return null;
  if (!isInFrustum(candidate.position)) return null;

  const direction = candidate.position.clone().sub(headPosition);
  direction.z = 0;
  if (direction.lengthSq() <= MINIMUM_DIRECTION_LENGTH_SQUARED) return null;
  direction.normalize();
  const horizontalAngleRadians = Math.acos(THREE.MathUtils.clamp(
    horizontalForward.dot(direction),
    -1,
    1,
  ));
  if (horizontalAngleRadians > MAXIMUM_HORIZONTAL_ANGLE_RADIANS) return null;
  return { candidate, horizontalAngleRadians };
}

function isValidCandidate(candidate: VRWorldPromptCandidate): boolean {
  return Boolean(candidate) &&
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.name) &&
    candidate.position instanceof THREE.Vector3 &&
    isFiniteVector3(candidate.position) &&
    Number.isFinite(candidate.actorDistanceMetres) &&
    candidate.actorDistanceMetres >= 0 &&
    typeof candidate.inRange === 'boolean' &&
    typeof candidate.hasActions === 'boolean';
}

function isValidAction(action: VRWorldPromptAction): boolean {
  return Boolean(action) &&
    action.kind === 'action' &&
    isNonEmptyString(action.id) &&
    isNonEmptyString(action.label) &&
    (action.icon === undefined || isNonEmptyString(action.icon)) &&
    typeof action.revalidate === 'function' &&
    typeof action.activate === 'function';
}

function validateHeadPose(headPose: XRWorldPose): void {
  if (!headPose ||
    !(headPose.position instanceof THREE.Vector3) ||
    !isFiniteVector3(headPose.position) ||
    !(headPose.orientation instanceof THREE.Quaternion) ||
    !isFiniteQuaternion(headPose.orientation) ||
    headPose.orientation.lengthSq() <= MINIMUM_DIRECTION_LENGTH_SQUARED) {
    throw new TypeError('head pose must contain a finite position and non-zero orientation');
  }
}

function isFiniteVector3(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isFiniteQuaternion(quaternion: THREE.Quaternion): boolean {
  return Number.isFinite(quaternion.x) &&
    Number.isFinite(quaternion.y) &&
    Number.isFinite(quaternion.z) &&
    Number.isFinite(quaternion.w);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
