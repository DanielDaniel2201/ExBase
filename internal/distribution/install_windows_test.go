package distribution

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestJunctionPathIsSameInstallation(t *testing.T) {
	root := t.TempDir()
	target, alias := filepath.Join(root, "actual"), filepath.Join(root, "alias")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", alias, target).CombinedOutput(); err != nil {
		t.Fatalf("create junction: %s: %v", output, err)
	}
	if !samePath(alias, target) {
		a, ea := filepath.EvalSymlinks(alias)
		b, eb := filepath.EvalSymlinks(target)
		t.Fatalf("junction was not recognized: alias=%q (%v), target=%q (%v)", a, ea, b, eb)
	}
	if value, changed := changePath(alias, target, false); value != alias || changed {
		t.Fatal("registering a junction created a duplicate PATH entry")
	}
	if value, changed := changePath(alias, target, true); value != "" || !changed {
		t.Fatal("unregistering did not recognize the junction entry")
	}
}

func TestUserPathChanges(t *testing.T) {
	for _, test := range []struct {
		value, dir string
		remove     bool
		want       string
		changed    bool
	}{
		{"", `D:\Apps\ExBase`, false, `D:\Apps\ExBase`, true},
		{`C:\Tools;D:\Apps\ExBase`, `d:\apps\exbase\`, false, `C:\Tools;D:\Apps\ExBase`, false},
		{`C:\Tools;D:\Apps\ExBase;D:\Apps\ExBaseOther`, `D:\Apps\ExBase`, true, `C:\Tools;D:\Apps\ExBaseOther`, true},
		{`C:\Tools`, `D:\Apps\ExBase`, true, `C:\Tools`, false},
		{strings.Repeat(`C:\Long;`, 600), `D:\Apps\ExBase`, false, strings.TrimRight(strings.Repeat(`C:\Long;`, 600), ";") + `;D:\Apps\ExBase`, true},
	} {
		got, changed := changePath(test.value, test.dir, test.remove)
		if got != test.want || changed != test.changed {
			t.Fatalf("PATH mismatch: changed=%v, len=%d, expected len=%d", changed, len(got), len(test.want))
		}
	}
}
