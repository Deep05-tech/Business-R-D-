import axios from 'axios';
async function test() {
    try {
        const url = "https://www.facebook.com/plugins/video.php?href=" + encodeURIComponent("https://www.facebook.com/reel/2077530653121493/");
        const res = await axios.get(url);
        console.log("Success, length:", res.data.length);
    } catch(e) {
        console.log("Failed", e.message);
    }
}
test();
