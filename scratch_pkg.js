import axios from 'axios';
async function test() {
    try {
        const res = await axios.get("https://saveig.app/api/ajaxSearch", {
            params: { q: "https://www.instagram.com/reel/C7m-K8sO_3H/", t: "media", lang: "en" }
        });
        console.log(res.data);
    } catch(e) {
        console.error(e.message);
    }
}
test();
