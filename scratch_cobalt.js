const url = "https://www.instagram.com/p/C6Z7gB4v3h9/";
fetch("https://api.cobalt.tools/api/json", {
    method: 'POST',
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: url })
}).then(res => res.json()).then(data => console.log(data)).catch(err => console.error(err));
