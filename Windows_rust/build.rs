fn main() {
    println!("cargo:rerun-if-changed=../web/player");
    println!("cargo:rerun-if-changed=../Windows_exe/assets/icon.png");
    println!("cargo:rerun-if-changed=../music_app/providers/qishui/runtime/signer.cjs");
}
