//! ساخت «مُهر» کلید عمومی داخل فایل اجرایی.
//!
//! چرا: اگر کلید عمومی فقط یک فایل کنار برنامه باشد، با Notepad عوض می‌شود و
//! هر کسی می‌تواند برای خودش لایسنس بسازد. با گذاشتن کلید داخل باینری،
//! دور زدن نیاز به وصله‌کردن فایل اجرایی دارد، نه ویرایش یک فایل متنی.
//!
//! منبع: `src-tauri/seal/public-key.txt` (کلید عمومی base64 که ابزار لایسنس
//! می‌سازد). خروجی: `$OUT_DIR/seal.rs` با دو ثابت:
//!   `SEALED_PUBLIC_KEY`: بایت‌های کلید که با یک کلید ثابت XOR شده‌اند
//!   `SEAL_FINGERPRINT`: SHA-256 کلید خام (برای تشخیص تغییر)
//!
//! ساخت بدون این فایل هم ممکن است (توسعه) — آن‌وقت هر دو ثابت خالی‌اند و
//! برنامه از مسیر فایل استفاده می‌کند. یک `cargo:rerun-if-changed` هم هست تا
//! با عوض شدن کلید، بیلد دوباره اجرا شود.

use std::env;
use std::fs;
use std::path::PathBuf;

const KEY: [u8; 16] = [
    0x46, 0x52, 0x44, 0x59, 0x2d, 0x53, 0x45, 0x41, 0x4c, 0x2d, 0x76, 0x31, 0x21, 0x7a, 0x51, 0x39,
];

fn mix(byte: u8, i: usize) -> u8 {
    let k = KEY[(i * 7 + 3) % KEY.len()];
    byte ^ k.wrapping_add((i as u8).wrapping_mul(31))
}

fn sha256_hex(data: &[u8]) -> String {
    /* پیاده‌سازی مشترک با seal.rs (بدون وابستگی بیرونی) */
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut a = h;
        for i in 0..64 {
            let s1 = a[4].rotate_right(6) ^ a[4].rotate_right(11) ^ a[4].rotate_right(25);
            let ch = (a[4] & a[5]) ^ ((!a[4]) & a[6]);
            let t1 = a[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a[0].rotate_right(2) ^ a[0].rotate_right(13) ^ a[0].rotate_right(22);
            let maj = (a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]);
            let t2 = s0.wrapping_add(maj);
            a[7] = a[6];
            a[6] = a[5];
            a[5] = a[4];
            a[4] = a[3].wrapping_add(t1);
            a[3] = a[2];
            a[2] = a[1];
            a[1] = a[0];
            a[0] = t1.wrapping_add(t2);
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(a[i]);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let key_file = manifest.join("seal").join("public-key.txt");
    println!("cargo:rerun-if-changed={}", key_file.display());
    /* کلید «صفر کردن داده» — جدا از کلید لایسنس (دور ۲۲) */
    let reset_file = manifest.join("seal").join("reset-key.txt");
    println!("cargo:rerun-if-changed={}", reset_file.display());
    println!("cargo:rerun-if-changed=build.rs");

    /*
     * ── کلید صفر کردن داده (Reset Key) ──
     *
     * ابزار بیرونی «صفر کردن سیستم» باید ثابت کند که مالکِ همین نسخه است.
     * اگر این کلید **داخل باینری** نباشد و فقط فایل کنار برنامه باشد، هر
     * کسی می‌تواند آن را عوض کند و با ابزار خودش داده‌ی مشتری را پاک کند.
     * با مُهر شدن، عوض کردنش نیاز به وصله‌کردن فایل اجرایی دارد.
     *
     * نبودنش برنامه را نمی‌شکند: `reset_key_present()` → false و ابزار
     * صفر کردن با پیام روشن «این نسخه مُهر نشده» کار نمی‌کند.
     */
    let reset_raw = fs::read_to_string(&reset_file).unwrap_or_default();
    let reset_key = reset_raw.trim().as_bytes();
    let (sealed_reset, reset_fp) = if reset_key.is_empty() {
        println!("cargo:warning=کلید صفر کردن داده (src-tauri/seal/reset-key.txt) نیست — ابزار صفر کردن روی این نسخه کار نمی‌کند (فقط برای توسعه)");
        (Vec::new(), String::new())
    } else {
        let mut out = Vec::with_capacity(reset_key.len());
        for (i, b) in reset_key.iter().enumerate() {
            out.push(mix(*b, i));
        }
        (out, sha256_hex(reset_key))
    };

    let raw = fs::read_to_string(&key_file).unwrap_or_default();
    let key = raw.trim().as_bytes();
    let (sealed, fingerprint) = if key.is_empty() {
        println!("cargo:warning=کلید عمومی لایسنس (src-tauri/seal/public-key.txt) نیست — نسخه بدون مُهر ساخته می‌شود (فقط برای توسعه)");
        (Vec::new(), String::new())
    } else {
        let mut out = Vec::with_capacity(key.len());
        for (i, b) in key.iter().enumerate() {
            out.push(mix(*b, i));
        }
        (out, sha256_hex(key))
    };

    let body = format!(
        "pub const SEALED_PUBLIC_KEY: &[u8] = &[{}];\npub const SEAL_FINGERPRINT: &str = {:?};\n\
         pub const SEALED_RESET_KEY: &[u8] = &[{}];\npub const RESET_FINGERPRINT: &str = {:?};\n",
        sealed.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(", "),
        fingerprint,
        sealed_reset.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(", "),
        reset_fp
    );
    let out_file = PathBuf::from(env::var("OUT_DIR").unwrap_or_else(|_| ".".into())).join("seal.rs");
    if let Err(e) = fs::write(&out_file, body) {
        println!("cargo:warning=نوشتن seal.rs ناموفق بود: {e}");
    }

    tauri_build::build();
}
