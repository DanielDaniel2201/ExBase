package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type PromptTemplate struct {
	Name string `json:"name"`
	Body string `json:"body"`
}

func promptTemplatesFile() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, ".exbase", "prompt-templates.json"), err
}

func (a *App) LoadPromptTemplates() ([]PromptTemplate, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	path, err := promptTemplatesFile()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return []PromptTemplate{{Name: "PPT · Frame 演示", Body: `请在当前画布上用 Excalidraw Frame 制作一套演示文稿，每个 Frame 对应一页。

主题：{{主题}}
受众：{{受众}}
页数：{{页数}}
内容与要点：{{内容与要点}}

布局：每页使用 1600 × 900 的 16:9 Frame，按从左到右的顺序排列，页面之间保留间距。所有页面内容都放在对应 Frame 内，Frame 使用清晰的页码与标题命名。
文本：使用中文；标题 48 px，正文 28 px，注释 20 px；每页一个核心观点，正文最多 5 条短句，保持一致的字体和层级。
色彩：白色背景，深灰 #202124 正文，蓝色 #2563eb 强调，浅灰 #f3f4f6 辅助区域；全套演示保持一致。
风格：简洁、专业、留白充足。优先使用图示、流程或对比来解释内容，避免文字堆叠。已有画布内容应保留，新页面放在空白区域。`}}, nil
	}
	if err != nil {
		return nil, err
	}
	templates := []PromptTemplate{}
	if err := json.Unmarshal(data, &templates); err != nil {
		return nil, errors.New("cannot read prompt templates")
	}
	if templates == nil {
		templates = []PromptTemplate{}
	}
	return templates, nil
}

func (a *App) SavePromptTemplates(templates []PromptTemplate) error {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	names := map[string]bool{}
	for i := range templates {
		t := &templates[i]
		t.Name = strings.TrimSpace(t.Name)
		name := strings.ToLower(t.Name)
		if t.Name == "" || utf8.RuneCountInString(t.Name) > 80 || strings.ContainsAny(t.Name, "\r\n") {
			return errors.New("template names must contain 1–80 characters on one line")
		}
		if names[name] {
			return errors.New("template names must be unique")
		}
		names[name] = true
		if strings.TrimSpace(t.Body) == "" || utf8.RuneCountInString(t.Body) > 16000 {
			return errors.New("template content must contain 1–16000 characters")
		}
	}
	if templates == nil {
		templates = []PromptTemplate{}
	}
	path, err := promptTemplatesFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(templates, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), "prompt-templates-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
