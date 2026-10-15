import { useState } from 'react';

interface DescriptionModalProps {
  onConfirm: (description: string) => void;
  onClose: () => void;
}

/**
 * 上传封面时填描述。位置在点上传按钮时已经确定，这里只收集描述文字。
 */
export function DescriptionModal({ onConfirm, onClose }: DescriptionModalProps) {
  const [description, setDescription] = useState('');

  function confirm() {
    onConfirm(description.trim());
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add a description">
      <div className="modal__panel">
        <h2 className="modal__title">Add a description</h2>

        <label className="field">
          <span>Description</span>
          <textarea
            className="field__textarea"
            placeholder="A short note shown at the bottom of this collection's page"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={confirm}>
            Choose image
          </button>
        </div>
      </div>
    </div>
  );
}
