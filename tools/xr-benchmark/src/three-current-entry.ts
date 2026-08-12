import * as THREECurrent from 'three-current';
import type * as ThreeTypes from 'three';
import { mountBenchmarkPage } from './BenchmarkUI';
import { startThreeBenchmark } from './ThreeBenchmark';

void mountBenchmarkPage({
  title: 'THREE current baseline',
  description: 'The matched cube on pinned current THREE, isolated from KOTOR engine code.',
  start: (hooks) =>
    startThreeBenchmark(
      THREECurrent as unknown as typeof ThreeTypes,
      'three-current',
      hooks
    ),
});
