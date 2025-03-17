import React, { useState } from 'react';
import defaultPhoto from '../images/defaultphoto.png';
import '../style/profile.css';
import { useAuthUser } from '../security/AuthContext';

const Profile = () => {
  const { user, updateUser } = useAuthUser();
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    currentPassword: '',
    newPassword: ''
  });

  if (!user) {
    return <div className="profile-container">Loading...</div>;
  }

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const localPhotoUrl = URL.createObjectURL(file);
    setIsLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('photo', file);

      const response = await fetch('http://localhost:8000/update-photo', {
        method: 'PUT',
        credentials: 'include',
        body: formData
      });

      if (response.ok) {
        const updatedUser = await response.json();
        console.log('Updated user data:', updatedUser);
        URL.revokeObjectURL(localPhotoUrl);
        updateUser({
          ...user,
          ...updatedUser
        });
      } else {
        throw new Error('Failed to update photo');
      }
    } catch (error) {
      console.error('Failed to update photo:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = (type) => {
    setModalType(type);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const endpoint = `http://localhost:8000/update-${modalType}`;
      const body = modalType === 'password' 
        ? { 
            currentPassword: formData.currentPassword, 
            newPassword: formData.newPassword 
          }
        : { username: formData.username };

      const response = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        const data = await response.json();
        if (modalType === 'username') {
          updateUser(data);
        }
        setShowModal(false);
        setFormData({ username: '', currentPassword: '', newPassword: '' });
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      console.error('Update failed:', error);
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="profile-container">
      <div className="profile-header">
        <h1>Profile</h1>
        <div className="update-buttons">
          <button className="btn" onClick={() => handleUpdateProfile('username')}>
            Update Username
          </button>
          <button className="btn" onClick={() => handleUpdateProfile('password')}>
            Update Password
          </button>
        </div>
      </div>

      <div className="profile-photo-container">
        <img
          src={user.userPhoto || defaultPhoto}
          alt="Profile Photo"
          className="profile-photo"
        />
        <label className="photo-overlay" htmlFor="photo-input">
          {isLoading ? 'Uploading...' : 'Click to Update Photo'}
        </label>
        <input
          type="file"
          id="photo-input"
          hidden
          accept="image/*"
          onChange={handlePhotoChange}
        />
      </div>

      <div className="profile-info">
        <div className="info-item">
          <strong>Username:</strong>
          <span>{user.userName}</span>
        </div>
        <div className="info-item">
          <strong>Email:</strong>
          <span>{user.email}</span>
        </div>
        <div className="info-item">
          <strong>Phone:</strong>
          <span>{user.phoneNumber}</span>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Update {modalType.charAt(0).toUpperCase() + modalType.slice(1)}</h2>
            <form onSubmit={handleSubmit}>
              {modalType === 'password' ? (
                <>
                  <div className="form-group">
                    <label htmlFor="currentPassword">Current Password*</label>
                    <input
                      type="password"
                      id="currentPassword"
                      value={formData.currentPassword}
                      onChange={(e) => setFormData({...formData, currentPassword: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="newPassword">New Password*</label>
                    <input
                      type="password"
                      id="newPassword"
                      value={formData.newPassword}
                      onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
                      required
                    />
                  </div>
                </>
              ) : (
                <div className="form-group">
                  <label htmlFor="username">New Username*</label>
                  <input
                    type="text"
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData({...formData, username: e.target.value})}
                    required
                  />
                </div>
              )}
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" disabled={isLoading}>
                  {isLoading ? 'Updating...' : 'Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
