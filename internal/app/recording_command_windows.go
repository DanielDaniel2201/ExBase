package app

import (
	"os/exec"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var recordingJob struct {
	once   sync.Once
	handle windows.Handle
	err    error
}

func recordingCommand(path string, args ...string) *exec.Cmd {
	command := exec.Command(path, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command
}

func startRecordingCommand(command *exec.Cmd) error {
	recordingJob.once.Do(func() {
		recordingJob.handle, recordingJob.err = windows.CreateJobObject(nil, nil)
		if recordingJob.err != nil {
			return
		}
		info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
		info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		_, recordingJob.err = windows.SetInformationJobObject(recordingJob.handle, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)))
	})
	if recordingJob.err != nil {
		return recordingJob.err
	}
	if err := command.Start(); err != nil {
		return err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(command.Process.Pid))
	if err == nil {
		err = windows.AssignProcessToJobObject(recordingJob.handle, process)
		windows.CloseHandle(process)
	}
	if err != nil {
		command.Process.Kill()
		command.Wait()
	}
	// The job handle stays open for the app lifetime. Windows closes it and kills
	// every capture/encoder child on a crash, forced close or Wails dev rebuild.
	return err
}
