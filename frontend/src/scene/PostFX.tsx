import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { Quality } from "../store/store";

/** Medium/High: HDR bloom on lit windows, lamps, beacons and route glows, then ACES tone mapping. */
export default function PostFX({ quality }: { quality: Quality }) {
  return (
    <EffectComposer multisampling={quality === "high" ? 4 : 0}>
      <Bloom intensity={quality === "high" ? 1.25 : 1.05} luminanceThreshold={0.9} luminanceSmoothing={0.35} mipmapBlur radius={quality === "high" ? 0.75 : 0.65} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.62} eskil={false} />
    </EffectComposer>
  );
}
