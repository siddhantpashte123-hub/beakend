# bluebeakend (Python SDK)

```python
from bluebeakend import Bluebeakend

bb = Bluebeakend(
    api_key="bb_live_xxx",
    auth_domain="api.myapp.com",
    project_id="my-python-app",
)

bb.auth.signup("user@x.com", "pass123")
doc = bb.db.collection("todos").add({"title": "Buy milk", "done": False})
items = bb.db.collection("todos").where("done", "==", False).get()
bb.db.collection("todos").doc(doc["id"]).update({"done": True})
```
