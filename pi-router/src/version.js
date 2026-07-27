export const VERSION = "0.4.0";
export const RELEASE_REPOSITORY = "thoitiettxl-cyber/codex-gauntlet-termux";
export const RELEASE_TAG_PREFIX = "pi-router-v";
export const RELEASE_ASSET = "pi-router-android-aarch64";
export const RELEASE_CHECKSUM_ASSET = `${RELEASE_ASSET}.sha256`;
export const RELEASE_ARTIFACT_MARKER_SUFFIX = ":management-center:termux-sea-v1";

export function releaseArtifactMarker(version) {
	return `pi-router:${version}${RELEASE_ARTIFACT_MARKER_SUFFIX}`;
}

export const BINARY_BUILD = Boolean(
	typeof __PI_ROUTER_BINARY_BUILD__ !== "undefined"
	&& __PI_ROUTER_BINARY_BUILD__,
);
