import { describe, it, expect } from "vitest";
import { isInstagramBundleHash, verifyPostAuthor } from "./socialVerificationUtils";

describe("socialVerificationUtils", () => {
  it("correctly identifies and rejects Instagram JS bundle chunk hashes", () => {
    const fakeShortcodes = [
      "Yv5Pcb2ZU36PuJz8y7iQaOsSDQWgvk",
      "yv5pcb2zu36p",
      "qTfXdjJ4Bd96T5YuJheHlVPXSqTQm",
      "qtfxdjj4bd9",
      "kj4GsFGO0rtFy48yejAHxDPIKbkA",
      "kj4gsfgo0rt",
      "rpZTIMpB7jiLH325lL7qWl46t9zRXP",
      "rpztimpb7ji"
    ];

    for (const code of fakeShortcodes) {
      expect(isInstagramBundleHash(code)).toBe(true);
      expect(isInstagramBundleHash(`https://www.instagram.com/p/${code}/`)).toBe(true);
      expect(isInstagramBundleHash(`https://www.instagram.com/reel/${code}`)).toBe(true);
    }
  });

  it("accepts authentic Instagram post shortcodes", () => {
    const authenticShortcodes = [
      "DB8y45ytaVD",
      "DNXRxmxB_Hw",
      "DCo5-Aix2d7",
      "DDfF4Q_PyOv",
      "DVm_jcHmQqF",
      "C2T8TIhqLde",
      "DOEOLyCDlBR"
    ];

    for (const code of authenticShortcodes) {
      expect(isInstagramBundleHash(code)).toBe(false);
      expect(isInstagramBundleHash(`https://www.instagram.com/p/${code}/`)).toBe(false);
    }
  });

  it("verifyPostAuthor rejects posts that contain bundle chunk hashes", () => {
    const postDetails = {
      authorHandle: "Yv5Pcb2ZU36Pu",
      postUrl: "https://www.instagram.com/p/Yv5Pcb2ZU36PuJz8y7iQaOsSDQWgvk/",
      caption: "Sample text"
    };

    const isValid = verifyPostAuthor("Instagram", postDetails, "Amtech", "https://instagram.com/amtechcast");
    expect(isValid).toBe(false);
  });

  it("extracts Facebook numeric photo IDs accurately across all URL formats", () => {
    const fbRegex = /(?:fbid=|\/photos\/(?:[^\/]+\/)?|\/photo\/?\?fbid=|\bmedia_id=)(\d{8,25})/i;

    const urls = [
      { url: "https://www.facebook.com/prevailcasting/photos/876751245710980", id: "876751245710980" },
      { url: "https://www.facebook.com/novelvalves/photos/2355268104741288", id: "2355268104741288" },
      { url: "https://www.facebook.com/photo.php?fbid=123456789012345&set=a.100", id: "123456789012345" },
      { url: "https://www.facebook.com/permalink.php?story_fbid=1647243002799484&id=61566402308082", id: "1647243002799484" },
      { url: "https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=122194241624546743", id: "122194241624546743" }
    ];

    for (const { url, id } of urls) {
      const match = url.match(fbRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(id);
    }
  });
});
