//! Shared helper for turning a Maven coordinate (group:artifact:version[:classifier])
//! into the relative jar path used by both the vanilla launcher layout and Fabric's.

use std::path::PathBuf;

pub fn maven_coord_to_path(coordinate: &str) -> String {
    let parts: Vec<&str> = coordinate.split(':').collect();
    if parts.len() < 3 {
        return coordinate.replace(':', "/");
    }
    let group_path = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).map(|s| format!("-{s}"));
    let filename = format!("{artifact}-{version}{}.jar", classifier.unwrap_or_default());
    PathBuf::from(group_path)
        .join(artifact)
        .join(version)
        .join(filename)
        .to_string_lossy()
        .replace('\\', "/")
}
