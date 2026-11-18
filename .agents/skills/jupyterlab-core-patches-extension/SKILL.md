---
name: jupyterlab-core-patches-extension
description: Delete a file or folder to the trash from the command line with the `trash-put` CLI of jupyterlab_core_patches_extension. Use when deleting an item on a workspace mount of the same disk, when the stock trash-put would copy a large folder into the home trash, or when scripting a delete to the trash.
---

# trash-put

Moves a file or folder to the trash. A plain path on a mount other than the home trash's mount is renamed into `<mount>/.Trash-<uid>` with its `.trashinfo`, so nothing is copied into the home trash. Flags, exit codes and the fallback: `trash-put --help`.

## Usage

```bash
trash-put FILE...
```

- **Cross-mount path** - renamed by the mount logic of the server patch; a failed rename prints the error, leaves the item in place and exits 1
- **Same-mount path** - the stock `/usr/bin/trash-put` takes the whole argument list
- **Option or no argument** - the stock `/usr/bin/trash-put` takes the arguments unchanged; its exit code and output pass through
- **Unusable mount trash** - a mount root that is read-only, or an unreadable `/proc`, sends the whole argument list to the stock command
- **PATH** - the console script installs into the environment bin folder, which precedes `/usr/bin` on the lab PATH
